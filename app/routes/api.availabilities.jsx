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
 */

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  const url = new URL(request.url);
  const serviceId = url.searchParams.get("serviceId");
  const date = url.searchParams.get("date");
  const employeeId = url.searchParams.get("employeeId"); // Optional: filter by specific employee

  console.log('[API] /api/availabilities - Request received:', {
    serviceId,
    date,
    employeeId,
    origin: request.headers.get("origin"),
  });

  if (!serviceId || !date) {
    return Response.json({ error: "serviceId and date are required" }, { status: 400 });
  }

  try {
    // Get store with settings
    const store = await prisma.store.findUnique({
      where: { shop },
      include: {
        settings: true,
        employees: {
          where: { isActive: true },
          include: {
            schedules: {
              where: {
                date: new Date(date),
              },
            },
          },
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
          include: {
            bookings: {
              where: {
                date: new Date(date),
                status: { in: ['confirmed', 'pending'] },
              },
            },
          },
        },
      },
    });

    if (!store) {
      return Response.json({ error: "Store not found" }, { status: 404 });
    }

    const service = store.services[0];
    if (!service) {
      return Response.json({ error: "Service not found" }, { status: 404 });
    }

    const settings = store.settings || {
      workingHoursStart: "09:00",
      workingHoursEnd: "17:00",
      openDays: "1,2,3,4,5",
      useResources: false,
    };

    // Check if the requested date is an open day
    const requestedDate = new Date(date);
    const dayOfWeek = requestedDate.getDay();
    const openDays = settings.openDays.split(",").map(Number);
    
    if (!openDays.includes(dayOfWeek)) {
      return Response.json({
        date,
        service: {
          id: service.id.toString(),
          title: service.productTitle,
          duration: service.duration,
        },
        availabilities: [],
        message: "Store is closed on this day",
      });
    }

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
      return Response.json({
        date,
        service: {
          id: service.id.toString(),
          title: service.productTitle,
          duration: service.duration,
        },
        availabilities: [],
        message: "No employees available for this service",
      });
    }

    // Filter resources by service's resource type if applicable
    let eligibleResources = store.resources;
    if (settings.useResources && service.resourceTypeId) {
      eligibleResources = store.resources.filter(
        (resource) => resource.resourceTypeId.toString() === service.resourceTypeId.toString()
      );
    }

    // Calculate available slots
    const availabilities = calculateAvailableSlots({
      employees: eligibleEmployees,
      service,
      date,
      workingHoursStart: settings.workingHoursStart,
      workingHoursEnd: settings.workingHoursEnd,
      useResources: settings.useResources,
      resources: eligibleResources,
    });

    const response = {
      date,
      service: {
        id: service.id.toString(),
        title: service.productTitle,
        duration: service.duration,
      },
      useResources: settings.useResources,
      availabilities,
    };
    
    console.log('[API] /api/availabilities - Response:', {
      date: response.date,
      service: response.service,
      availabilityCount: availabilities.length,
      useResources: response.useResources,
    });
    
    return Response.json(response);
  } catch (error) {
    console.error('[API] /api/availabilities - Error:', error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
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
    const schedule = employee.schedules[0]; // Schedule for the requested date

    // Get existing bookings for this employee on this date
    const bookedSlots = schedule?.slots ? JSON.parse(JSON.stringify(schedule.slots)) : [];
    const unavailableRanges = bookedSlots
      .filter((slot) => !slot.isAvailable)
      .map((slot) => ({
        start: parseTimeToDate(date, slot.startTime),
        end: parseTimeToDate(date, slot.endTime),
      }));

    // Generate potential time slots (every 15 minutes)
    let currentTime = new Date(workStart);
    while (currentTime < workEnd) {
      const slotEnd = new Date(currentTime.getTime() + serviceDuration * 60000);

      // Check if slot end is within working hours
      if (slotEnd <= workEnd) {
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

      // Move to next 15-minute interval
      currentTime = new Date(currentTime.getTime() + 15 * 60000);
    }

    slots.push(...employeeSlots);
  });

  // If resources are enabled, filter slots by resource availability
  if (useResources && resources.length > 0) {
    const slotsWithResources = [];
    
    slots.forEach((slot) => {
      // Check which resources are available for this time slot
      const availableResources = resources.filter((resource) => {
        // Get bookings for this resource at this time
        const resourceBookings = resource.bookings || [];
        const slotStart = parseTimeToDate(date, slot.startTime);
        const slotEnd = parseTimeToDate(date, slot.endTime);
        
        // Count how many bookings overlap with this slot
        const overlappingBookings = resourceBookings.filter((booking) => {
          const bookingStart = parseTimeToDate(date, booking.startTime);
          const bookingEnd = parseTimeToDate(date, booking.endTime);
          return slotStart < bookingEnd && slotEnd > bookingStart;
        }).length;
        
        // Resource is available if overlapping bookings < quantity
        return overlappingBookings < resource.quantity;
      });
      
      // Only include slot if at least one resource is available
      if (availableResources.length > 0) {
        slotsWithResources.push({
          ...slot,
          requiresResource: true,
          availableResources: availableResources.map((r) => ({
            id: r.id.toString(),
            name: r.name,
            quantity: r.quantity,
            available: r.quantity - (r.bookings?.filter((b) => {
              const slotStart = parseTimeToDate(date, slot.startTime);
              const slotEnd = parseTimeToDate(date, slot.endTime);
              const bookingStart = parseTimeToDate(date, b.startTime);
              const bookingEnd = parseTimeToDate(date, b.endTime);
              return slotStart < bookingEnd && slotEnd > bookingStart;
            }).length || 0),
          })),
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
