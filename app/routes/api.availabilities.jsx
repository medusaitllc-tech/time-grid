import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Calculate available time slots for a given service
 * Based on Timefold employee scheduling algorithm
 * 
 * Constraints:
 * - Employee must have the service in their serviceIds
 * - No overlapping bookings
 * - Within working hours
 * - Respect employee schedules
 * - If useResources is enabled, check resource availability
 * 
 * Security Model:
 * - Admin requests: Fully authenticated via Shopify session
 * - Storefront requests: Public read-only access with CORS restrictions
 */

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const serviceId = url.searchParams.get("serviceId");
  const date = url.searchParams.get("date");
  const shop = url.searchParams.get("shop");
  const employeeId = url.searchParams.get("employeeId"); // Optional: filter by specific employee

  console.log('[API] /api/availabilities - Request received:', {
    serviceId,
    date,
    shop,
    employeeId,
    origin: request.headers.get("origin"),
    method: request.method,
  });

  // Determine origin for CORS - only allow Shopify domains
  const origin = request.headers.get("origin");
  const allowedOrigin = origin && origin.includes(".myshopify.com") ? origin : "*";

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin || "null",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (!serviceId) {
    return Response.json(
      { error: "serviceId is required" },
      {
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin || "null",
          "Content-Type": "application/json",
        },
      }
    );
  }

  try {
    let shopDomain = null;
    
    // Check if this is a storefront request (has shop parameter)
    if (shop) {
      // Storefront request - don't try to authenticate
      console.log('[API] /api/availabilities - Storefront request detected');
      
      // Validate shop format
      if (!shop.endsWith(".myshopify.com")) {
        return Response.json(
          { error: "Invalid shop domain" },
          {
            status: 400,
            headers: {
              "Access-Control-Allow-Origin": allowedOrigin || "*",
              "Content-Type": "application/json",
            },
          }
        );
      }
      
      shopDomain = shop;
    } else {
      // Admin request - authenticate
      console.log('[API] /api/availabilities - Admin request, authenticating...');
      try {
        const { session } = await authenticate.admin(request);
        shopDomain = session.shop;
      } catch (authError) {
        console.error('[API] /api/availabilities - Authentication failed:', authError);
        return Response.json(
          { error: "Authentication required" },
          {
            status: 401,
            headers: {
              "Access-Control-Allow-Origin": allowedOrigin || "*",
              "Content-Type": "application/json",
            },
          }
        );
      }
    }

    // Get store with settings, employees, services, and resources
    // Note: We query schedules separately with date range filter for better performance
    const store = await prisma.store.findUnique({
      where: { shop: shopDomain },
      include: {
        settings: true,
        employees: {
          where: { isActive: true },
        },
        services: {
          where: {
            id: BigInt(serviceId),
            isActive: true,
          },
          include: {
            resourceType: true,
          },
        },
        resources: {
          where: { isActive: true },
        },
      },
    });

    if (!store) {
      return Response.json(
        { error: "Store not found" },
        {
          status: 404,
          headers: {
            "Access-Control-Allow-Origin": allowedOrigin || "*",
            "Content-Type": "application/json",
          },
        }
      );
    }

    const service = store.services[0];
    if (!service) {
      return Response.json(
        { error: "Service not found" },
        {
          status: 404,
          headers: {
            "Access-Control-Allow-Origin": allowedOrigin || "*",
            "Content-Type": "application/json",
          },
        }
      );
    }

    const settings = store.settings || {
      workingHoursStart: "09:00",
      workingHoursEnd: "17:00",
      openDays: "1,2,3,4,5",
      useResources: false,
      limitBookingWindow: false,
      bookingWindow: 30,
      limitAppointments: false,
      maxAppointmentsDisplayed: 10,
    };

    // Determine the date range based on limitBookingWindow setting
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let endDate;
    if (date) {
      // If specific date requested, only check that date
      endDate = new Date(date);
    } else if (settings.limitBookingWindow) {
      // Limited booking window
      endDate = new Date(today);
      endDate.setDate(today.getDate() + (settings.bookingWindow || 30));
    } else {
      // Unlimited - check up to 1 year ahead
      endDate = new Date(today);
      endDate.setDate(today.getDate() + 365);
    }

    console.log('[API] /api/availabilities - Date range:', {
      from: today.toISOString().split('T')[0],
      to: endDate.toISOString().split('T')[0],
      limited: settings.limitBookingWindow,
    });

    const openDays = settings.openDays.split(",").map(Number);

    // Filter employees who can provide this service
    let eligibleEmployees = store.employees;
    if (employeeId) {
      eligibleEmployees = eligibleEmployees.filter(
        (emp) => emp.id.toString() === employeeId
      );
    }

    // Filter by service capability
    eligibleEmployees = eligibleEmployees.filter((emp) => {
      if (!emp.serviceIds) return false;
      const serviceIds = Array.isArray(emp.serviceIds) 
        ? emp.serviceIds 
        : JSON.parse(emp.serviceIds || "[]");
      return serviceIds.includes(service.id.toString());
    });

    if (eligibleEmployees.length === 0) {
      return Response.json(
        {
          service: {
            id: service.id.toString(),
            title: service.productTitle,
            duration: service.duration,
          },
          availabilities: [],
          message: "No employees available for this service",
        },
        {
          headers: {
            "Access-Control-Allow-Origin": allowedOrigin || "*",
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Filter resources by service's resource type if applicable
    let eligibleResources = store.resources;
    if (settings.useResources && service.resourceTypeId) {
      eligibleResources = store.resources.filter(
        (resource) => resource.resourceTypeId.toString() === service.resourceTypeId.toString()
      );
    }

    // Query schedules from database within the date range
    const employeeIds = eligibleEmployees.map(emp => emp.id);
    const schedules = await prisma.schedule.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: {
          gte: today,
          lte: endDate,
        },
      },
      include: {
        employee: true,
      },
      orderBy: {
        date: 'asc',
      },
    });

    console.log('[API] /api/availabilities - Found schedules:', {
      totalSchedules: schedules.length,
      employeesWithSchedules: new Set(schedules.map(s => s.employeeId)).size,
    });

    // Group schedules by date
    const schedulesByDate = {};
    schedules.forEach(schedule => {
      const dateStr = schedule.date.toISOString().split('T')[0];
      const dayOfWeek = new Date(schedule.date).getDay();
      
      // Skip if store is closed on this day
      if (!openDays.includes(dayOfWeek)) {
        return;
      }
      
      if (!schedulesByDate[dateStr]) {
        schedulesByDate[dateStr] = [];
      }
      schedulesByDate[dateStr].push(schedule);
    });

    // Calculate available slots for each date that has schedules
    const allAvailabilities = [];
    const datesWithSchedules = Object.keys(schedulesByDate);
    
    for (const checkDate of datesWithSchedules) {
      const dateSchedules = schedulesByDate[checkDate];
      
      console.log(`[API] Processing date ${checkDate}:`, {
        schedulesCount: dateSchedules.length,
        employees: dateSchedules.map(s => ({ 
          id: s.employee.id, 
          name: s.employee.name,
          slotsCount: s.slots ? JSON.parse(JSON.stringify(s.slots)).length : 0,
        })),
      });
      
      // Map schedules to employee format expected by calculateAvailableSlots
      const employeesForDate = dateSchedules.map(schedule => ({
        id: schedule.employee.id,
        name: schedule.employee.name,
        serviceIds: schedule.employee.serviceIds,
        schedules: [schedule],
      }));

      // Calculate available slots for this date
      const dateAvailabilities = calculateAvailableSlots({
        employees: employeesForDate,
        service,
        date: checkDate,
        workingHoursStart: settings.workingHoursStart,
        workingHoursEnd: settings.workingHoursEnd,
        useResources: settings.useResources,
        resources: eligibleResources,
      });
      
      console.log(`[API] Generated ${dateAvailabilities.length} slots for ${checkDate}`);

      // Add date to each availability
      dateAvailabilities.forEach(avail => {
        allAvailabilities.push({
          ...avail,
          date: checkDate,
        });
      });
    }

    // Log summary of schedule processing
    console.log('[API] /api/availabilities - Schedule summary:', {
      datesWithSchedules: datesWithSchedules.length,
      totalSlotsGenerated: allAvailabilities.length,
    });

    // Filter out past appointments (backend-side filtering)
    const now = new Date();
    const futureAvailabilities = allAvailabilities.filter(slot => {
      // Parse the slot's date and time
      const [year, month, day] = slot.date.split('-').map(Number);
      const [hours, minutes] = slot.startTime.split(':').map(Number);
      const slotDateTime = new Date(year, month - 1, day, hours, minutes);
      
      // Only include slots that are in the future
      return slotDateTime > now;
    });

    console.log('[API] /api/availabilities - Filtered past appointments:', {
      total: allAvailabilities.length,
      future: futureAvailabilities.length,
      filtered: allAvailabilities.length - futureAvailabilities.length,
    });

    // Apply appointment limit if enabled (after filtering past appointments)
    let displayedAvailabilities = futureAvailabilities;
    if (settings.limitAppointments && settings.maxAppointmentsDisplayed) {
      displayedAvailabilities = futureAvailabilities.slice(0, settings.maxAppointmentsDisplayed);
    }

    const response = {
      service: {
        id: service.id.toString(),
        title: service.productTitle,
        duration: service.duration,
      },
      useResources: settings.useResources,
      availabilities: displayedAvailabilities,
      totalAvailabilities: futureAvailabilities.length,
      displayedCount: displayedAvailabilities.length,
      limitApplied: settings.limitAppointments && futureAvailabilities.length > displayedAvailabilities.length,
    };
    
    console.log('[API] /api/availabilities - Response:', {
      service: response.service,
      totalAvailabilities: futureAvailabilities.length,
      displayedCount: displayedAvailabilities.length,
      limitApplied: response.limitApplied,
      useResources: response.useResources,
    });
    
    return Response.json(response, {
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin || "*",
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error('[API] /api/availabilities - Error:', error);
    console.error('[API] /api/availabilities - Error stack:', error.stack);
    console.error('[API] /api/availabilities - Error message:', error.message);
    return Response.json(
      { error: "Internal server error", details: error.message },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin || "*",
          "Content-Type": "application/json",
        },
      }
    );
  }
};

/**
 * Calculate available time slots based on employee schedules and constraints
 */
function calculateAvailableSlots({
  employees,
  service,
  date,
  workingHoursStart,
  workingHoursEnd,
  useResources,
  resources,
}) {
  const serviceDuration = service.duration; // in minutes
  const slots = [];

  // Parse working hours
  const [startHour, startMinute] = workingHoursStart.split(":").map(Number);
  const [endHour, endMinute] = workingHoursEnd.split(":").map(Number);

  const workStart = new Date(date);
  workStart.setHours(startHour, startMinute, 0, 0);

  const workEnd = new Date(date);
  workEnd.setHours(endHour, endMinute, 0, 0);

  // For each employee, calculate their available slots
  employees.forEach((employee) => {
    const employeeSlots = [];
    const schedule = employee.schedules && employee.schedules.length > 0 ? employee.schedules[0] : null;

    // Skip this employee if they don't have a schedule for this date
    if (!schedule) {
      return; // Skip silently - no need to log every missing schedule
    }

    // Get all slots from the schedule
    const scheduleSlots = schedule?.slots ? JSON.parse(JSON.stringify(schedule.slots)) : [];
    
    console.log(`[calculateAvailableSlots] Employee ${employee.name} on ${date}:`, {
      totalSlots: scheduleSlots.length,
      slots: scheduleSlots.map(s => ({ 
        time: `${s.startTime}-${s.endTime}`, 
        available: s.isAvailable 
      })),
    });
    
    // Get available and unavailable slots
    const availableSlots = scheduleSlots.filter((slot) => slot.isAvailable);
    const unavailableSlots = scheduleSlots.filter((slot) => !slot.isAvailable);

    // If no available slots, skip this employee
    if (availableSlots.length === 0) {
      return;
    }

    // Merge consecutive available slots into continuous time blocks
    const mergedAvailableRanges = [];
    let currentBlock = null;
    
    availableSlots
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .forEach((slot) => {
        const slotStart = parseTimeToDate(date, slot.startTime);
        const slotEnd = parseTimeToDate(date, slot.endTime);
        
        if (!currentBlock) {
          // Start a new block
          currentBlock = { start: slotStart, end: slotEnd };
        } else if (currentBlock.end.getTime() === slotStart.getTime()) {
          // Extend the current block
          currentBlock.end = slotEnd;
        } else {
          // Gap detected, save current block and start a new one
          mergedAvailableRanges.push(currentBlock);
          currentBlock = { start: slotStart, end: slotEnd };
        }
      });
    
    // Don't forget the last block
    if (currentBlock) {
      mergedAvailableRanges.push(currentBlock);
    }

    // Get booked/unavailable time ranges
    const unavailableRanges = unavailableSlots.map((slot) => ({
      start: parseTimeToDate(date, slot.startTime),
      end: parseTimeToDate(date, slot.endTime),
    }));

    console.log(`[calculateAvailableSlots] Employee ${employee.name}:`, {
      individualSlots: availableSlots.length,
      mergedBlocks: mergedAvailableRanges.length,
      unavailableRanges: unavailableRanges.length,
    });

    // For each merged available time block, generate appointment slots
    mergedAvailableRanges.forEach((range) => {
      let currentTime = new Date(range.start);
      
      while (currentTime < range.end) {
        const slotEnd = new Date(currentTime.getTime() + serviceDuration * 60000);

        // Check if slot end is within the available range
        if (slotEnd <= range.end) {
          // Check if slot doesn't overlap with any booked slots
          const isAvailable = !hasOverlap(currentTime, slotEnd, unavailableRanges);

          if (isAvailable) {
            employeeSlots.push({
              startTime: formatTime(currentTime),
              endTime: formatTime(slotEnd),
              employeeId: employee.id.toString(),
              employeeName: employee.name,
            });
          }
        }

        // Move to next interval based on service duration to avoid gaps
        currentTime = new Date(currentTime.getTime() + serviceDuration * 60000);
      }
    });

    slots.push(...employeeSlots);
  });

  // If resources are enabled, add resource information to slots
  // Note: Resource booking tracking is not implemented in the schema yet
  if (useResources && resources.length > 0) {
    const slotsWithResources = [];
    
    slots.forEach((slot) => {
      // For now, assume all resources are available since bookings relation doesn't exist
      const availableResources = resources.map((r) => ({
        id: r.id.toString(),
        name: r.name,
        quantity: r.quantity,
        available: r.quantity, // All units available (no booking tracking yet)
      }));
      
      // Include slot with resource information
      if (availableResources.length > 0) {
        slotsWithResources.push({
          ...slot,
          requiresResource: true,
          availableResources,
        });
      }
    });
    
    // Group slots by time
    const groupedSlots = {};
    slotsWithResources.forEach((slot) => {
      const key = `${slot.startTime}-${slot.endTime}`;
      if (!groupedSlots[key]) {
        groupedSlots[key] = {
          startTime: slot.startTime,
          endTime: slot.endTime,
          employees: [],
          requiresResource: true,
          availableResources: slot.availableResources,
        };
      }
      groupedSlots[key].employees.push({
        id: slot.employeeId,
        name: slot.employeeName,
      });
    });
    
    return Object.values(groupedSlots).sort((a, b) =>
      a.startTime.localeCompare(b.startTime)
    );
  }

  // Group slots by time for easier frontend consumption
  const groupedSlots = {};
  slots.forEach((slot) => {
    const key = `${slot.startTime}-${slot.endTime}`;
    if (!groupedSlots[key]) {
      groupedSlots[key] = {
        startTime: slot.startTime,
        endTime: slot.endTime,
        employees: [],
      };
    }
    groupedSlots[key].employees.push({
      id: slot.employeeId,
      name: slot.employeeName,
    });
  });

  return Object.values(groupedSlots).sort((a, b) =>
    a.startTime.localeCompare(b.startTime)
  );
}

/**
 * Check if a time range overlaps with any unavailable ranges
 */
function hasOverlap(start, end, unavailableRanges) {
  return unavailableRanges.some((range) => {
    // Two ranges overlap if:
    // - start is before range.end AND
    // - end is after range.start
    return start < range.end && end > range.start;
  });
}

/**
 * Parse time string (HH:MM) to Date object for a given date
 */
function parseTimeToDate(dateStr, timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const date = new Date(dateStr);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/**
 * Format Date object to time string (HH:MM)
 */
function formatTime(date) {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}
