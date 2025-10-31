# Availability Calculation Algorithm

## Overview

This API calculates available time slots for booking appointments based on employee schedules, service requirements, and resource availability. The algorithm is adapted from the Timefold employee scheduling constraint solver.

## API Endpoint

```
GET /api/availabilities?serviceId={id}&date={YYYY-MM-DD}&employeeId={id}
```

### Parameters

- **serviceId** (required): The ID of the service to book
- **date** (required): The date for which to calculate availabilities (format: YYYY-MM-DD)
- **employeeId** (optional): Filter results for a specific employee

### Response Format

```json
{
  "date": "2025-10-30",
  "service": {
    "id": "123",
    "title": "Haircut",
    "duration": 30
  },
  "useResources": false,
  "availabilities": [
    {
      "startTime": "09:00",
      "endTime": "09:30",
      "employees": [
        {
          "id": "1",
          "name": "John"
        },
        {
          "id": "2",
          "name": "Jane"
        }
      ]
    }
  ]
}
```

## Algorithm Logic

### 1. **Constraint Validation**

The algorithm implements the following hard constraints from Timefold:

#### a. **Service Capability Constraint**
- Employees must have the requested service in their `serviceIds`
- Similar to Timefold's `requiredSkill` constraint

#### b. **No Overlapping Bookings**
- Checks existing schedule slots to ensure no double-booking
- Implements overlap detection: `start < range.end && end > range.start`
- Based on Timefold's `noOverlappingShifts` constraint

#### c. **Working Hours Constraint**
- All slots must fall within the store's working hours
- Respects the `workingHoursStart` and `workingHoursEnd` settings

#### d. **Open Days Constraint**
- Only calculates slots for days when the store is open
- Checks against the `openDays` setting

### 2. **Time Slot Generation**

```javascript
// Generate slots in 15-minute intervals
let currentTime = workStart;
while (currentTime < workEnd) {
  const slotEnd = currentTime + serviceDuration;
  
  if (slotEnd <= workEnd && !hasOverlap(currentTime, slotEnd, bookedSlots)) {
    // Slot is available
    availableSlots.push({
      startTime: formatTime(currentTime),
      endTime: formatTime(slotEnd),
      employeeId,
      employeeName
    });
  }
  
  currentTime += 15 minutes;
}
```

### 3. **Overlap Detection Algorithm**

Based on interval overlap mathematics:

```javascript
function hasOverlap(start, end, unavailableRanges) {
  return unavailableRanges.some(range => {
    // Two intervals overlap if:
    // start < range.end AND end > range.start
    return start < range.end && end > range.start;
  });
}
```

**Visual representation:**
```
Case 1: Overlap
  [----slot----]
      [----booked----]
  
Case 2: No overlap
  [----slot----]
                  [----booked----]

Case 3: Overlap
      [----slot----]
  [----booked----]
```

### 4. **Resource Management** (Optional)

When `useResources` is enabled:

```javascript
if (useResources && resources.length > 0) {
  return slots.map(slot => ({
    ...slot,
    requiresResource: true,
    availableResources: resources.map(r => ({
      id: r.id,
      name: r.name,
      quantity: r.quantity
    }))
  }));
}
```

### 5. **Slot Grouping**

Slots are grouped by time to show all available employees for each time slot:

```javascript
const groupedSlots = {};
slots.forEach(slot => {
  const key = `${slot.startTime}-${slot.endTime}`;
  if (!groupedSlots[key]) {
    groupedSlots[key] = {
      startTime: slot.startTime,
      endTime: slot.endTime,
      employees: []
    };
  }
  groupedSlots[key].employees.push({
    id: slot.employeeId,
    name: slot.employeeName
  });
});
```

## Timefold Constraints Mapping

| Timefold Constraint | Our Implementation |
|---------------------|-------------------|
| `requiredSkill` | Service capability check (serviceIds) |
| `noOverlappingShifts` | Overlap detection with booked slots |
| `unavailableEmployee` | Schedule-based availability |
| `oneShiftPerDay` | Implicit in schedule structure |
| `atLeast10HoursBetweenTwoShifts` | Not implemented (can be added) |

## Performance Considerations

1. **Time Complexity**: O(n * m) where:
   - n = number of employees
   - m = number of 15-minute intervals in working hours

2. **Optimization Opportunities**:
   - Cache employee schedules for frequently requested dates
   - Pre-calculate common time slots
   - Use database indexes on `date` and `employeeId`

## Example Usage

### Request
```bash
GET /api/availabilities?serviceId=123&date=2025-10-30
```

### Response
```json
{
  "date": "2025-10-30",
  "service": {
    "id": "123",
    "title": "Haircut",
    "duration": 30
  },
  "useResources": false,
  "availabilities": [
    {
      "startTime": "09:00",
      "endTime": "09:30",
      "employees": [
        { "id": "1", "name": "John" },
        { "id": "2", "name": "Jane" }
      ]
    },
    {
      "startTime": "09:15",
      "endTime": "09:45",
      "employees": [
        { "id": "1", "name": "John" }
      ]
    }
  ]
}
```

## Future Enhancements

1. **Break Time Constraints**: Add minimum break time between appointments
2. **Employee Preferences**: Implement soft constraints for preferred/undesired times
3. **Load Balancing**: Distribute appointments evenly across employees
4. **Resource Capacity**: Track resource usage and prevent overbooking
5. **Multi-day Availability**: Calculate availability across multiple days
6. **Recurring Appointments**: Support for recurring booking patterns

## References

- [Timefold Solver Documentation](https://timefold.ai)
- [Employee Scheduling Quickstart](https://github.com/TimefoldAI/timefold-quickstarts/tree/main/java/employee-scheduling)
- Interval Overlap Algorithm: [Wikipedia - Interval Scheduling](https://en.wikipedia.org/wiki/Interval_scheduling)
