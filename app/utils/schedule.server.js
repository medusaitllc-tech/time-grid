import prisma from "../db.server";

/**
 * Generate time slots for a given date based on settings
 * @param {Object} settings - Store settings with workingHours and timeSlotSize
 * @param {Date} date - The date to generate slots for
 * @returns {Array} Array of slot objects
 */
export function generateSlots(settings, date) {
  const slots = [];
  const dayOfWeek = date.getDay();
  const openDays = settings.openDays.split(",").map(Number);

  // Check if the day is open
  if (!openDays.includes(dayOfWeek)) {
    return slots; // Return empty array for closed days
  }

  const [startHour, startMinute] = settings.workingHoursStart.split(":").map(Number);
  const [endHour, endMinute] = settings.workingHoursEnd.split(":").map(Number);
  
  const startTimeMinutes = startHour * 60 + startMinute;
  const endTimeMinutes = endHour * 60 + endMinute;
  const slotSize = settings.timeSlotSize;

  // Generate slots
  for (let time = startTimeMinutes; time < endTimeMinutes; time += slotSize) {
    const slotStartHour = Math.floor(time / 60);
    const slotStartMinute = time % 60;
    const slotEndTime = time + slotSize;
    const slotEndHour = Math.floor(slotEndTime / 60);
    const slotEndMinute = slotEndTime % 60;

    slots.push({
      startTime: `${String(slotStartHour).padStart(2, "0")}:${String(slotStartMinute).padStart(2, "0")}`,
      endTime: `${String(slotEndHour).padStart(2, "0")}:${String(slotEndMinute).padStart(2, "0")}`,
      isAvailable: true,
      bookingId: null,
    });
  }

  return slots;
}

/**
 * Get or create schedule for an employee on a specific date
 * @param {string} employeeId - Employee ID
 * @param {string} shop - Shop domain
 * @param {Date} date - The date
 * @param {Object} settings - Store settings
 * @returns {Promise<Object>} Schedule object
 */
export async function getOrCreateSchedule(employeeId, shop, date, settings) {
  // Normalize date to start of day
  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);

  // Try to find existing schedule
  let schedule = await prisma.schedule.findUnique({
    where: {
      employeeId_date: {
        employeeId,
        date: normalizedDate,
      },
    },
  });

  // If not found, create new schedule with generated slots
  if (!schedule) {
    const slots = generateSlots(settings, normalizedDate);
    
    schedule = await prisma.schedule.create({
      data: {
        employeeId,
        shop,
        date: normalizedDate,
        slots,
      },
    });
  }

  return schedule;
}

/**
 * Get schedules for an employee within a date range
 * @param {string} employeeId - Employee ID
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} Array of schedule objects
 */
export async function getSchedulesForRange(employeeId, startDate, endDate) {
  return await prisma.schedule.findMany({
    where: {
      employeeId,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: {
      date: "asc",
    },
  });
}

/**
 * Update a specific slot in a schedule
 * @param {string} scheduleId - Schedule ID
 * @param {string} slotStartTime - Start time of the slot to update
 * @param {Object} updates - Updates to apply (isAvailable, bookingId)
 * @returns {Promise<Object>} Updated schedule
 */
export async function updateSlot(scheduleId, slotStartTime, updates) {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
  });

  if (!schedule) {
    throw new Error("Schedule not found");
  }

  const slots = schedule.slots;
  const slotIndex = slots.findIndex((slot) => slot.startTime === slotStartTime);

  if (slotIndex === -1) {
    throw new Error("Slot not found");
  }

  // Update the slot
  slots[slotIndex] = {
    ...slots[slotIndex],
    ...updates,
  };

  // Save updated schedule
  return await prisma.schedule.update({
    where: { id: scheduleId },
    data: { slots },
  });
}

/**
 * Generate schedules for an employee for a date range
 * @param {string} employeeId - Employee ID
 * @param {string} shop - Shop domain
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {Object} settings - Store settings
 * @returns {Promise<Array>} Array of created schedules
 */
export async function generateSchedulesForRange(employeeId, shop, startDate, endDate, settings) {
  const schedules = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const schedule = await getOrCreateSchedule(employeeId, shop, new Date(currentDate), settings);
    schedules.push(schedule);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return schedules;
}
