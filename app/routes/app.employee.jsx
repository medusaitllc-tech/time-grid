import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useRevalidator, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get current month date range from query params or use current month
  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month");
  const yearParam = url.searchParams.get("year");
  
  const now = new Date();
  const year = yearParam ? parseInt(yearParam) : now.getFullYear();
  const month = monthParam ? parseInt(monthParam) : now.getMonth();
  
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0);

  // Get store with settings, services, and resource types
  const store = await prisma.store.findUnique({
    where: { shop },
    include: {
      employees: {
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
      },
      settings: true,
      services: {
        where: { isActive: true },
        orderBy: { productTitle: "asc" },
        include: {
          resourceType: true,
        },
      },
    },
  });

  // Get schedules for current month and adjacent months (for navigation)
  const schedules = await prisma.schedule.findMany({
    where: {
      shop,
      date: {
        gte: new Date(year, month - 1, 1), // Previous month
        lte: new Date(year, month + 2, 0),  // Next month end
      },
    },
  });

  // Default settings if none exist
  const settings = store?.settings || {
    workingHoursStart: "09:00",
    workingHoursEnd: "17:00",
    openDays: "1,2,3,4,5",
  };
  
  // Default slot size for schedule display (15 minutes)
  const SLOT_SIZE_MINUTES = 15;

  return { 
    employees: store?.employees || [], 
    settings, 
    schedules,
    services: store?.services || [],
    storeId: store?.id,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const actionType = formData.get("action");
  const name = formData.get("name");

  console.log("Action called:", { actionType, name, shop });

  // Get or create store
  let store = await prisma.store.findUnique({
    where: { shop },
  });

  if (!store) {
    console.log("Store not found, creating one...");
    store = await prisma.store.create({
      data: {
        shop,
        isActive: true,
      },
    });
  }

  if (actionType === "create" && name) {
    const avatarUrl = formData.get("avatarUrl");
    console.log("Creating employee:", name, "with avatar:", avatarUrl);
    const employee = await prisma.employee.create({
      data: {
        name: name.toString(),
        avatarUrl: avatarUrl?.toString() || null,
        shop,
        storeId: store.id,
      },
    });
    console.log("Employee created:", employee);
    return { success: true, employee };
  }

  if (actionType === "updateServices") {
    const employeeId = formData.get("employeeId");
    const serviceIdsJson = formData.get("serviceIds");
    const serviceIds = JSON.parse(serviceIdsJson);

    await prisma.employee.update({
      where: { id: BigInt(employeeId) },
      data: { serviceIds, updatedAt: new Date() },
    });

    return { success: true, action: "updateServices" };
  }

  if (actionType === "saveSchedule") {
    const employeeId = formData.get("employeeId");
    const dateStr = formData.get("date"); // Expected: "YYYY-MM-DD"
    const slotsJson = formData.get("slots");
    const slots = JSON.parse(slotsJson);

    console.log("Saving schedule - received:", { employeeId, dateStr, slotsCount: slots.length });

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      console.error("Invalid date format:", dateStr);
      return { success: false, error: "Invalid date format. Expected YYYY-MM-DD" };
    }

    // Parse as UTC date to avoid timezone shift
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day)); // UTC date at midnight
    
    console.log("Date parsing:", {
      input: dateStr,
      parsed: { year, month, day },
      dateObject: date,
      toISOString: date.toISOString(),
    });

    // Upsert schedule
    const result = await prisma.schedule.upsert({
      where: {
        employeeId_date: {
          employeeId,
          date,
        },
      },
      update: {
        slots,
        updatedAt: new Date(),
      },
      create: {
        employeeId,
        shop,
        date,
        slots,
      },
    });

    console.log("Schedule saved - result:", {
      id: result.id,
      date: result.date,
      dateISO: new Date(result.date).toISOString(),
    });

    return { success: true, action: "saveSchedule", date: dateStr };
  }

  if (actionType === "duplicateSchedule") {
    const employeeId = BigInt(formData.get("employeeId"));
    const targetDates = JSON.parse(formData.get("targetDates"));
    const slots = JSON.parse(formData.get("slots"));

    // Create or update schedules for all target dates
    const results = await Promise.all(
      targetDates.map(dateStr => {
        // Parse as UTC date to avoid timezone shift
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        
        return prisma.schedule.upsert({
          where: {
            employeeId_date: {
              employeeId,
              date,
            },
          },
          update: {
            slots,
            updatedAt: new Date(),
          },
          create: {
            employeeId,
            shop,
            date,
            slots,
          },
        });
      })
    );

    return { success: true, action: "duplicateSchedule", count: results.length };
  }

  if (actionType === "deleteSchedule") {
    const scheduleId = formData.get("scheduleId");

    console.log("Deleting schedule:", scheduleId);

    await prisma.schedule.delete({
      where: { id: scheduleId },
    });

    return { success: true, action: "deleteSchedule" };
  }

  return { success: false, error: "Invalid action or missing name" };
};

export default function EmployeePage() {
  const { employees, settings, schedules, services } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showServicePicker, setShowServicePicker] = useState(false);
  const [showDeleteServiceModal, setShowDeleteServiceModal] = useState(false);
  const [showDeleteScheduleModal, setShowDeleteScheduleModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState(null);
  const [scheduleToDelete, setScheduleToDelete] = useState(null);
  const [scheduleToDuplicate, setScheduleToDuplicate] = useState(null);
  const [selectedDuplicateDays, setSelectedDuplicateDays] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlots, setSelectedSlots] = useState([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState([]);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState("man");
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const lastProcessedEmployeeId = useRef(null);
  const lastEmployeeUpdate = useRef(null);

  // Default avatar URLs (from public directory)
  const defaultAvatars = {
    man: "/avatar-man.svg",
    woman: "/avatar-woman.svg"
  };
  
  // Default slot size for schedule display (15 minutes)
  const SLOT_SIZE_MINUTES = 15;

  // Auto-select first employee on initial load
  useEffect(() => {
    if (!selectedEmployee && employees.length > 0) {
      setSelectedEmployee(employees[0]);
    }
  }, [employees, selectedEmployee]);

  // Update selected employee when data changes
  useEffect(() => {
    if (selectedEmployee && employees.length > 0) {
      const updatedEmployee = employees.find(e => e.id.toString() === selectedEmployee.id.toString());
      if (updatedEmployee) {
        // Only update if the data actually changed (check serviceIds)
        const currentServiceIds = JSON.stringify(selectedEmployee.serviceIds);
        const newServiceIds = JSON.stringify(updatedEmployee.serviceIds);
        
        if (currentServiceIds !== newServiceIds || lastEmployeeUpdate.current !== newServiceIds) {
          lastEmployeeUpdate.current = newServiceIds;
          setSelectedEmployee(updatedEmployee);
        }
      }
    }
  }, [employees, selectedEmployee]);

  // Revalidate after service updates
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success && fetcher.data?.action === "updateServices") {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data]);

  // Revalidate after schedule save to ensure schedules are loaded for other months
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success && fetcher.data?.action === "saveSchedule") {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data]);

  // Helper to find schedule for a specific date and employee
  const getScheduleForDate = (date, employeeId) => {
    if (!employeeId) return null;
    
    // Format local date as YYYY-MM-DD without timezone conversion
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    return schedules.find(s => {
      // Schedule dates are stored in UTC, extract just the date part
      const scheduleDate = new Date(s.date).toISOString().split('T')[0];
      return s.employeeId.toString() === employeeId.toString() && scheduleDate === dateStr;
    });
  };

  // Handle delete schedule
  const handleDeleteSchedule = (schedule, e) => {
    e.stopPropagation();
    setScheduleToDelete(schedule);
    setShowDeleteScheduleModal(true);
  };

  const handleConfirmDeleteSchedule = () => {
    if (scheduleToDelete) {
      fetcher.submit(
        { action: "deleteSchedule", scheduleId: scheduleToDelete.id.toString() },
        { method: "POST" }
      );
      setShowDeleteScheduleModal(false);
      setScheduleToDelete(null);
    }
  };

  const handleCancelDeleteSchedule = () => {
    setShowDeleteScheduleModal(false);
    setScheduleToDelete(null);
  };

  // Handle duplicate schedule
  const handleDuplicateSchedule = (schedule, e) => {
    e.stopPropagation();
    setScheduleToDuplicate(schedule);
    
    // Select all available days by default
    const availableDays = calendarDays.filter(dayInfo => {
      if (dayInfo.isEmpty) return false;
      // Exclude the source day and weekends
      const sourceDate = new Date(schedule.date).toISOString().split('T')[0];
      const thisDate = dayInfo.date.toISOString().split('T')[0];
      if (sourceDate === thisDate) return false;
      if (dayInfo.isWeekend) return false;
      // Check if day has time slots available
      const slots = generateTimeSlots(dayInfo.date);
      return slots.length > 0;
    }).map(dayInfo => dayInfo.date.toISOString().split('T')[0]);
    
    setSelectedDuplicateDays(availableDays);
    setShowDuplicateModal(true);
  };

  const handleToggleDuplicateDay = (date) => {
    const dateStr = date.toISOString().split('T')[0];
    setSelectedDuplicateDays(prev => {
      if (prev.includes(dateStr)) {
        return prev.filter(d => d !== dateStr);
      } else {
        return [...prev, dateStr];
      }
    });
  };

  const handleConfirmDuplicate = () => {
    if (scheduleToDuplicate && selectedDuplicateDays.length > 0) {
      // Submit all days in a single request
      fetcher.submit(
        {
          action: "duplicateSchedule",
          employeeId: selectedEmployee.id.toString(),
          sourceDateStr: new Date(scheduleToDuplicate.date).toISOString().split('T')[0],
          targetDates: JSON.stringify(selectedDuplicateDays),
          slots: JSON.stringify(scheduleToDuplicate.slots),
        },
        { method: "POST" }
      );
      setShowDuplicateModal(false);
      setScheduleToDuplicate(null);
      setSelectedDuplicateDays([]);
    }
  };

  const handleCancelDuplicate = () => {
    setShowDuplicateModal(false);
    setScheduleToDuplicate(null);
    setSelectedDuplicateDays([]);
  };

  // Watch for fetcher completion and reload data
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success && fetcher.data?.employee) {
      const employeeId = fetcher.data.employee.id;
      
      // Only process if this is a new employee we haven't seen before
      if (employeeId !== lastProcessedEmployeeId.current) {
        console.log("Success! New employee created:", employeeId);
        lastProcessedEmployeeId.current = employeeId;
        setNewEmployeeName("");
        setSelectedAvatar("man");
        setAvatarFile(null);
        setAvatarPreview(null);
        revalidator.revalidate();
      }
    }
  }, [fetcher.state, fetcher.data]);

  const isSubmitting = fetcher.state === "submitting";

  const handleAddEmployee = () => {
    if (newEmployeeName.trim()) {
      // Use uploaded file preview (base64), or default avatar
      const avatarUrl = avatarPreview || defaultAvatars[selectedAvatar];
      fetcher.submit(
        { 
          action: "create", 
          name: newEmployeeName,
          avatarUrl: avatarUrl
        },
        { method: "POST" }
      );
      // Close modal using command
      const closeBtn = document.querySelector('[commandFor="add-employee-modal"][command="--hide"]');
      if (closeBtn) closeBtn.click();
    }
  };


  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      // Create preview URL
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleOpenServicePicker = () => {
    if (selectedEmployee) {
      // Initialize with employee's current service IDs
      let currentServiceIds = selectedEmployee.serviceIds || [];
      if (typeof currentServiceIds === 'object' && !Array.isArray(currentServiceIds)) {
        currentServiceIds = [];
      }
      setSelectedServiceIds(currentServiceIds);
      setShowServicePicker(true);
    }
  };

  const handleToggleService = (serviceId) => {
    setSelectedServiceIds(prev => {
      if (prev.includes(serviceId)) {
        return prev.filter(id => id !== serviceId);
      } else {
        return [...prev, serviceId];
      }
    });
  };

  const handleToggleAllServices = () => {
    if (selectedServiceIds.length === services.length) {
      setSelectedServiceIds([]);
    } else {
      setSelectedServiceIds(services.map(s => s.id.toString()));
    }
  };

  const handleSaveServices = () => {
    if (selectedEmployee) {
      fetcher.submit(
        {
          action: "updateServices",
          employeeId: selectedEmployee.id.toString(),
          serviceIds: JSON.stringify(selectedServiceIds),
        },
        { method: "POST" }
      );
      setShowServicePicker(false);
    }
  };

  const handleCancelServicePicker = () => {
    setShowServicePicker(false);
    setSelectedServiceIds([]);
  };

  const handleDeleteServiceClick = (service) => {
    setServiceToDelete(service);
    setShowDeleteServiceModal(true);
  };

  const handleConfirmDeleteService = () => {
    if (serviceToDelete && selectedEmployee) {
      let employeeServiceIds = selectedEmployee.serviceIds || [];
      if (!Array.isArray(employeeServiceIds)) {
        employeeServiceIds = [];
      }
      const updatedServiceIds = employeeServiceIds.filter(id => id !== serviceToDelete.id.toString());
      
      fetcher.submit(
        {
          action: "updateServices",
          employeeId: selectedEmployee.id.toString(),
          serviceIds: JSON.stringify(updatedServiceIds),
        },
        { method: "POST" }
      );
      
      setShowDeleteServiceModal(false);
      setServiceToDelete(null);
    }
  };

  const handleCancelDeleteService = () => {
    setShowDeleteServiceModal(false);
    setServiceToDelete(null);
  };

  // Generate time slots based on settings
  const generateTimeSlots = (date) => {
    const slots = [];
    const dayOfWeek = date.getDay();
    const openDays = settings.openDays.split(",").map(Number);

    // Check if the day is open
    if (!openDays.includes(dayOfWeek)) {
      return slots;
    }

    const [startHour, startMinute] = settings.workingHoursStart.split(":").map(Number);
    const [endHour, endMinute] = settings.workingHoursEnd.split(":").map(Number);
    
    const startTimeMinutes = startHour * 60 + startMinute;
    const endTimeMinutes = endHour * 60 + endMinute;
    const slotSize = SLOT_SIZE_MINUTES; // Use constant instead of settings

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
  };

  // Handle date click to open schedule modal
  const handleDateClick = (date, forceEdit = false) => {
    if (!selectedEmployee) return;
    
    const slots = generateTimeSlots(date);
    if (slots.length === 0) {
      alert("This day is closed according to your settings.");
      return;
    }
    
    // Check if there's an existing schedule for this date
    const existingSchedule = getScheduleForDate(date, selectedEmployee.id);
    
    // If schedule exists and not forcing edit, just open edit mode directly
    if (existingSchedule && !forceEdit) {
      // Open edit mode with the existing schedule
      const allSlots = generateTimeSlots(date);
      const existingSlots = existingSchedule.slots;
      
      // Find indices of existing slots
      const selectedIndices = [];
      existingSlots.forEach(existingSlot => {
        const index = allSlots.findIndex(slot => slot.startTime === existingSlot.startTime);
        if (index !== -1) {
          selectedIndices.push(index);
        }
      });
      
      setSelectedDate(date);
      setSelectedSlots(selectedIndices);
      setShowScheduleModal(true);
      return;
    }
    
    setSelectedDate(date);
    
    // If schedule exists, load the saved slots, otherwise select all by default
    if (existingSchedule && existingSchedule.slots) {
      setSelectedSlots(existingSchedule.slots);
    } else {
      setSelectedSlots(slots.map((_, index) => index)); // Select all by default for new schedules
    }
    
    setShowScheduleModal(true);
  };

  // Toggle slot selection
  const toggleSlot = (index) => {
    if (selectedSlots.includes(index)) {
      setSelectedSlots(selectedSlots.filter(i => i !== index));
    } else {
      setSelectedSlots([...selectedSlots, index].sort((a, b) => a - b));
    }
  };

  // Save schedule
  const handleSaveSchedule = () => {
    if (!selectedEmployee || !selectedDate) return;

    const allSlots = generateTimeSlots(selectedDate);
    const slotsToSave = selectedSlots.map(index => allSlots[index]);

    // Format date as YYYY-MM-DD to avoid timezone issues
    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const day = String(selectedDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    fetcher.submit(
      {
        action: "saveSchedule",
        employeeId: selectedEmployee.id,
        date: dateStr,
        slots: JSON.stringify(slotsToSave),
      },
      { method: "POST" }
    );

    setShowScheduleModal(false);
  };

  // Month navigation functions
  const goToPreviousMonth = () => {
    const newDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    setCurrentDate(newDate);
  };

  const goToNextMonth = () => {
    const newDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
  };

  // Generate calendar days for current month
  const generateCalendarDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday
    
    const days = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ isEmpty: true, key: `empty-${i}` });
    }
    
    // Add actual days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const today = new Date();
      const isToday = date.toDateString() === today.toDateString();
      
      days.push({
        day,
        date,
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        isToday,
        key: `day-${day}`,
      });
    }
    return days;
  };

  const calendarDays = generateCalendarDays();
  const currentMonth = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <s-page heading="Employee assignments and availability">
      <s-query-container>
        <s-grid
          gridTemplateColumns="@container (inline-size > 768px) 1fr 2fr, 1fr"
          gap="base"
          alignItems="stretch"
        >
          {/* Employee List Column (1/3 width on desktop, full width on mobile) */}
          <s-grid-item style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                backgroundColor: "white",
                borderRadius: "12px",
                padding: "20px",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                display: "flex",
                flexDirection: "column",
                flex: 1,
                height: "100%",
              }}
            >
          <s-grid gap="base" style={{ flex: 1 }}>
            <s-grid gridTemplateColumns="1fr auto" alignItems="center">
              <s-heading>Employees</s-heading>
              <s-button commandFor="add-employee-modal" command="--show" variant="primary">
                Add Employee
              </s-button>
            </s-grid>

            {employees.length > 0 ? (
              <s-grid gap="small-200">
                {employees.map((employee) => (
                  <s-clickable
                    key={employee.id}
                    onClick={() => setSelectedEmployee(employee)}
                    padding="small"
                    borderRadius="base"
                    background={selectedEmployee?.id === employee.id ? "subdued" : "transparent"}
                  >
                    <s-grid
                      gridTemplateColumns="auto 1fr auto"
                      gap="base"
                      alignItems="center"
                    >
                      {employee.avatarUrl ? (
                        <img 
                          src={employee.avatarUrl} 
                          alt={employee.name}
                          style={{ 
                            width: "40px", 
                            height: "40px", 
                            borderRadius: "50%", 
                            objectFit: "cover",
                            border: "2px solid #e1e3e5"
                          }}
                        />
                      ) : (
                        <div style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "50%",
                          backgroundColor: "#f6f6f7",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "2px solid #e1e3e5"
                        }}>
                          <s-icon name="person" />
                        </div>
                      )}
                      <s-text variant="bodyMd" fontWeight="semibold">
                        {employee.name}
                      </s-text>
                      <s-badge tone="success">Active</s-badge>
                    </s-grid>
                  </s-clickable>
                ))}
              </s-grid>
            ) : (
              <s-box
                padding="base"
                borderRadius="base"
                border="base"
                background="subdued"
                textAlign="center"
              >
                <s-text color="subdued">No employees yet. Click "Add Employee" to get started.</s-text>
              </s-box>
            )}
          </s-grid>
            </div>
          </s-grid-item>

        {/* Monthly Schedule and Services Column (2/3 width on desktop, full width on mobile) */}
          <s-grid-item>
          <s-grid gap="base">
          {/* Services Provided Section */}
          <s-section>
            <s-grid gap="base">
              <s-heading>
                {selectedEmployee 
                  ? `Services Provided by ${selectedEmployee.name}` 
                  : "Select an employee to view services"}
              </s-heading>

              {selectedEmployee && (
                <s-grid gap="base">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <s-text variant="bodySm" color="subdued">
                      Select which services this employee can provide
                    </s-text>
                    <s-button onClick={handleOpenServicePicker}>
                      Manage Services
                    </s-button>
                  </div>
                  
                  {(() => {
                    let employeeServiceIds = selectedEmployee.serviceIds || [];
                    // Ensure it's an array
                    if (!Array.isArray(employeeServiceIds)) {
                      employeeServiceIds = [];
                    }
                    const selectedServices = services.filter(s => employeeServiceIds.includes(s.id.toString()));
                    
                    if (selectedServices.length === 0) {
                      return (
                        <s-box padding="base" background="subdued" borderRadius="base" textAlign="center">
                          <s-text variant="bodySm" color="subdued">
                            No services assigned. Click "Manage Services" to add services.
                          </s-text>
                        </s-box>
                      );
                    }
                    
                    return (
                      <div>
                        {/* Table Header */}
                        <div style={{
                          display: "grid",
                          gridTemplateColumns: "50px 1fr 120px 100px 60px",
                          gap: "12px",
                          padding: "8px 12px",
                          borderBottom: "2px solid #e1e3e5",
                          backgroundColor: "#f9fafb",
                          fontWeight: "600",
                          fontSize: "12px",
                          color: "#6d7175"
                        }}>
                          <div>IMAGE</div>
                          <div>SERVICE</div>
                          <div>RESOURCE TYPE</div>
                          <div>DURATION</div>
                          <div>ACTION</div>
                        </div>

                        {/* Table Rows */}
                        {selectedServices.map(service => (
                          <div key={service.id.toString()} style={{
                            display: "grid",
                            gridTemplateColumns: "50px 1fr 120px 100px 60px",
                            gap: "12px",
                            padding: "12px",
                            borderBottom: "1px solid #e1e3e5",
                            alignItems: "center"
                          }}>
                            <div>
                              {service.imageUrl ? (
                                <img 
                                  src={service.imageUrl} 
                                  alt={service.productTitle}
                                  style={{ width: "40px", height: "40px", borderRadius: "6px", objectFit: "cover" }}
                                />
                              ) : (
                                <div style={{ 
                                  width: "40px", 
                                  height: "40px", 
                                  borderRadius: "6px", 
                                  backgroundColor: "#f6f6f7",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center"
                                }}>
                                  <span style={{ fontSize: "20px" }}>📦</span>
                                </div>
                              )}
                            </div>
                            <div>
                              <div style={{ fontWeight: "600", fontSize: "14px" }}>
                                {service.productTitle}
                              </div>
                              {service.variantTitle && (
                                <div style={{ fontSize: "12px", color: "#6d7175" }}>
                                  {service.variantTitle}
                                </div>
                              )}
                            </div>
                            <div>
                              {service.resourceType ? (
                                <span style={{
                                  display: "inline-block",
                                  padding: "4px 8px",
                                  backgroundColor: "#e0e7ff",
                                  color: "#4338ca",
                                  borderRadius: "12px",
                                  fontSize: "11px",
                                  fontWeight: "500"
                                }}>
                                  {service.resourceType.name}
                                </span>
                              ) : (
                                <span style={{
                                  display: "inline-block",
                                  padding: "4px 8px",
                                  backgroundColor: "#f3f4f6",
                                  color: "#9ca3af",
                                  borderRadius: "12px",
                                  fontSize: "11px",
                                  fontWeight: "500"
                                }}>
                                  None
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: "14px" }}>
                              {service.duration} min
                            </div>
                            <div>
                              <button
                                onClick={() => handleDeleteServiceClick(service)}
                                style={{
                                  width: "32px",
                                  height: "32px",
                                  borderRadius: "6px",
                                  border: "1px solid #c9cccf",
                                  backgroundColor: "#fff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: "pointer",
                                  transition: "background-color 0.2s"
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#fef1f1"}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#fff"}
                                title="Remove service"
                              >
                                <s-icon type="delete" size="small" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </s-grid>
              )}

              {!selectedEmployee && (
                <s-box padding="base" background="subdued" borderRadius="base" textAlign="center">
                  <s-text color="subdued">Select an employee to manage their services</s-text>
                </s-box>
              )}
            </s-grid>
          </s-section>

          {/* Monthly Schedule Section */}
          <s-section>
            <s-grid gap="base">
              <s-heading>
                {selectedEmployee 
                  ? `Availability for ${selectedEmployee.name}` 
                  : "Select an employee to view availability"}
              </s-heading>

              {selectedEmployee && (
              <s-grid gap="base">
                {/* Month Navigation */}
                <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
                  <s-button 
                    onClick={goToPreviousMonth}
                    icon="chevron-left"
                    variant="tertiary"
                    accessibilityLabel="Previous month"
                  />
                  <s-stack direction="inline" gap="small" alignItems="center" justifyContent="center">
                    <s-text variant="headingMd">{currentMonth}</s-text>
                    <s-button 
                      onClick={goToToday}
                      variant="tertiary"
                      size="small"
                    >
                      Today
                    </s-button>
                  </s-stack>
                  <s-button 
                    onClick={goToNextMonth}
                    icon="chevron-right"
                    variant="tertiary"
                    accessibilityLabel="Next month"
                  />
                </s-grid>
                
                {/* Calendar Grid */}
                <s-box
                  border="base"
                  borderRadius="base"
                  padding="base"
                  background="base"
                >
                  <s-grid
                    gridTemplateColumns="repeat(7, 1fr)"
                    gap="small-200"
                  >
                    {/* Day headers */}
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                      <s-box
                        key={day}
                        padding="small"
                        textAlign="center"
                      >
                        <s-text variant="headingSm">{day}</s-text>
                      </s-box>
                    ))}

                    {/* Calendar days */}
                    {calendarDays.map((dayInfo) => {
                      if (dayInfo.isEmpty) {
                        return (
                          <s-box
                            key={dayInfo.key}
                            minBlockSize="60px"
                          />
                        );
                      }
                      
                      const hasSchedule = getScheduleForDate(dayInfo.date, selectedEmployee?.id);
                      
                      return (
                        <div
                          key={dayInfo.key}
                          style={{ 
                            cursor: "pointer",
                            position: "relative",
                            backgroundColor: hasSchedule 
                              ? "#a7f3d0" 
                              : (dayInfo.isToday ? "#e0f2fe" : (dayInfo.isWeekend ? "#f3f4f6" : "#ffffff")),
                            border: hasSchedule ? "2px solid #10b981" : "1px solid #e5e7eb",
                            borderRadius: "8px",
                            padding: "8px",
                            minHeight: "60px"
                          }}
                          onClick={() => handleDateClick(dayInfo.date)}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", height: "100%" }}>
                            <s-grid gap="small-100" style={{ flex: 1 }}>
                              <s-text 
                                variant="bodySm" 
                                fontWeight={dayInfo.isToday ? "bold" : "regular"}
                                color={dayInfo.isToday ? "inverse" : dayInfo.isWeekend ? "subdued" : "base"}
                              >
                                {dayInfo.day}
                              </s-text>
                              
                              {/* Show slot count if schedule exists */}
                              {hasSchedule && (
                                <s-text variant="bodySm" color={dayInfo.isToday ? "inverse" : "success"} fontWeight="semibold">
                                  ✓ {hasSchedule.slots.length} slots
                                </s-text>
                              )}
                            </s-grid>
                            
                            {/* Show action buttons if schedule exists */}
                            {(() => {
                              const schedule = getScheduleForDate(dayInfo.date, selectedEmployee?.id);
                              if (schedule) {
                                return (
                                  <div style={{ 
                                    display: "flex", 
                                    flexDirection: "column", 
                                    gap: "4px", 
                                    justifyContent: "center",
                                    marginRight: "-24px"
                                  }}>
                                    <div
                                      style={{
                                        width: "20px",
                                        height: "20px",
                                        borderRadius: "50%",
                                        backgroundColor: "#f1f1f1",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        cursor: "pointer",
                                        transition: "background-color 0.2s",
                                      }}
                                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#d1d1d1"}
                                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#f1f1f1"}
                                      onClick={(e) => handleDuplicateSchedule(schedule, e)}
                                      title="Duplicate to other days"
                                    >
                                      <s-icon type="duplicate" size="small" />
                                    </div>
                                    <div
                                      style={{
                                        width: "20px",
                                        height: "20px",
                                        borderRadius: "50%",
                                        backgroundColor: "#f1f1f1",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        cursor: "pointer",
                                        transition: "background-color 0.2s",
                                      }}
                                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#d1d1d1"}
                                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#f1f1f1"}
                                      onClick={(e) => handleDeleteSchedule(schedule, e)}
                                    >
                                      <s-icon type="delete" size="small" />
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </div>
                      );
                    })}
                  </s-grid>
                </s-box>
              </s-grid>
            )}

            {!selectedEmployee && (
              <s-box
                padding="extra-large"
                textAlign="center"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-text color="subdued">
                  Please select an employee from the list to view their monthly schedule
                </s-text>
              </s-box>
            )}
          </s-grid>
        </s-section>
        </s-grid>
          </s-grid-item>
        </s-grid>
      </s-query-container>

      {/* Add Employee Modal */}
      <s-modal id="add-employee-modal" heading="Add New Employee" size="large">
        <s-stack gap="base">
          <s-text-field
            label="Employee Name"
            value={newEmployeeName}
            onInput={(e) => setNewEmployeeName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newEmployeeName.trim()) {
                handleAddEmployee();
              }
            }}
            placeholder="Enter employee name"
            autoFocus
          />

          {/* Avatar Selection */}
          <s-box>
            <s-text variant="bodyMd" fontWeight="semibold" style={{ marginBottom: "8px" }}>
              Select Avatar
            </s-text>
            <div style={{ display: "flex", gap: "12px", marginBottom: "12px" }}>
              <div
                onClick={() => setSelectedAvatar("man")}
                style={{
                  width: "80px",
                  height: "80px",
                  borderRadius: "50%",
                  border: selectedAvatar === "man" ? "3px solid #2c6ecb" : "2px solid #e1e3e5",
                  cursor: "pointer",
                  overflow: "hidden",
                  transition: "border 0.2s"
                }}
              >
                <img 
                  src={defaultAvatars.man} 
                  alt="Man avatar"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
              <div
                onClick={() => setSelectedAvatar("woman")}
                style={{
                  width: "80px",
                  height: "80px",
                  borderRadius: "50%",
                  border: selectedAvatar === "woman" ? "3px solid #2c6ecb" : "2px solid #e1e3e5",
                  cursor: "pointer",
                  overflow: "hidden",
                  transition: "border 0.2s"
                }}
              >
                <img 
                  src={defaultAvatars.woman} 
                  alt="Woman avatar"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
            </div>
            
            <s-text variant="bodySm" color="subdued" style={{ marginBottom: "8px" }}>
              Or upload a custom photo:
            </s-text>
            
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: "none" }}
                id="avatar-upload"
              />
              <label
                htmlFor="avatar-upload"
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#f6f6f7",
                  border: "1px solid #c9cccf",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500"
                }}
              >
                Choose File
              </label>
              {avatarPreview && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <img 
                    src={avatarPreview} 
                    alt="Preview"
                    style={{ 
                      width: "40px", 
                      height: "40px", 
                      borderRadius: "50%", 
                      objectFit: "cover",
                      border: "2px solid #e1e3e5"
                    }}
                  />
                  <button
                    onClick={() => {
                      setAvatarFile(null);
                      setAvatarPreview(null);
                    }}
                    style={{
                      padding: "4px 8px",
                      backgroundColor: "transparent",
                      border: "1px solid #c9cccf",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "12px"
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </s-box>
        </s-stack>

        <s-button 
          slot="primary-action"
          onClick={handleAddEmployee} 
          variant="primary"
          disabled={!newEmployeeName.trim() || isSubmitting}
          loading={isSubmitting}
        >
          {isSubmitting ? "Saving..." : "Save"}
        </s-button>
        <s-button 
          slot="secondary-actions"
          commandFor="add-employee-modal" 
          command="--hide"
          variant="secondary" 
          disabled={isSubmitting}
        >
          Cancel
        </s-button>
      </s-modal>

      {/* Schedule Modal */}
      {showScheduleModal && selectedDate && (
        <>
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onClick={() => setShowScheduleModal(false)}
          >
            <div
              style={{
                backgroundColor: "white",
                borderRadius: "12px",
                padding: "24px",
                minWidth: "600px",
                maxWidth: "700px",
                maxHeight: "85vh",
                overflow: "auto",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.15)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <s-grid gap="base">
                <div>
                  <s-heading>Set Availability</s-heading>
                  <s-text variant="bodySm" color="subdued">
                    {selectedEmployee?.name} - {selectedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </s-text>
                </div>
                
                <div style={{
                  padding: "16px",
                  backgroundColor: "#f9fafb",
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb"
                }}>
                  <s-text variant="bodySm" fontWeight="semibold" style={{ marginBottom: "8px", display: "block" }}>
                    💡 Quick Tip
                  </s-text>
                  <s-text variant="bodySm" color="subdued">
                    Click on time slots to toggle availability. Selected slots will be highlighted in green.
                  </s-text>
                </div>

                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))",
                  gap: "4px",
                  maxHeight: "450px",
                  overflow: "auto",
                  padding: "4px"
                }}>
                  {generateTimeSlots(selectedDate).map((slot, index) => {
                    const isSelected = selectedSlots.includes(index);
                    return (
                      <div
                        key={index}
                        onClick={() => toggleSlot(index)}
                        style={{
                          padding: "6px 4px",
                          borderRadius: "4px",
                          border: isSelected ? "1.5px solid #10b981" : "1.5px solid #e5e7eb",
                          backgroundColor: isSelected ? "#d1fae5" : "#ffffff",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          textAlign: "center",
                          fontWeight: isSelected ? "600" : "500",
                          fontSize: "11px",
                          color: isSelected ? "#065f46" : "#374151",
                          userSelect: "none",
                          lineHeight: "1.2"
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.backgroundColor = "#f3f4f6";
                            e.currentTarget.style.borderColor = "#d1d5db";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.backgroundColor = "#ffffff";
                            e.currentTarget.style.borderColor = "#e5e7eb";
                          }
                        }}
                      >
                        <div>{slot.startTime}</div>
                        <div style={{ fontSize: "9px", opacity: 0.65, marginTop: "1px" }}>
                          {slot.endTime}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingTop: "8px",
                  borderTop: "1px solid #e5e7eb"
                }}>
                  <s-text variant="bodySm" color="subdued">
                    {selectedSlots.length} slot{selectedSlots.length !== 1 ? 's' : ''} selected
                  </s-text>
                  <s-stack direction="inline" gap="small">
                    <s-button 
                      onClick={() => setShowScheduleModal(false)} 
                      variant="tertiary"
                    >
                      Cancel
                    </s-button>
                    <s-button 
                      onClick={handleSaveSchedule} 
                      variant="primary"
                      disabled={selectedSlots.length === 0}
                    >
                      Save Availability
                    </s-button>
                  </s-stack>
                </div>
              </s-grid>
            </div>
          </div>
        </>
      )}

      {/* Service Picker Modal */}
      {showServicePicker && selectedEmployee && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={handleCancelServicePicker}
        >
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "600px",
              width: "90%",
              maxHeight: "80vh",
              overflow: "auto",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <s-grid gap="base">
              <s-text variant="headingMd">Manage Services for {selectedEmployee.name}</s-text>
              
              <s-text variant="bodySm" color="subdued">
                Select which services this employee can provide
              </s-text>

              {/* Select All / Deselect All */}
              <div style={{ borderBottom: "1px solid #e1e3e5", paddingBottom: "12px" }}>
                <s-checkbox
                  checked={selectedServiceIds.length === services.length}
                  onChange={handleToggleAllServices}
                >
                  <s-text fontWeight="semibold">
                    {selectedServiceIds.length === services.length ? "Deselect All" : "Select All Services"}
                  </s-text>
                </s-checkbox>
              </div>

              {/* Service List */}
              <s-grid gap="small">
                {services.map(service => (
                  <div
                    key={service.id.toString()}
                    onClick={() => handleToggleService(service.id.toString())}
                    style={{
                      padding: "12px",
                      border: "1px solid #e1e3e5",
                      borderRadius: "8px",
                      backgroundColor: selectedServiceIds.includes(service.id.toString()) ? "#f6f6f7" : "#fff",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedServiceIds.includes(service.id.toString())}
                      onChange={() => handleToggleService(service.id.toString())}
                      style={{ width: "20px", height: "20px", cursor: "pointer" }}
                    />
                    {service.imageUrl && (
                      <img 
                        src={service.imageUrl} 
                        alt={service.productTitle}
                        style={{ width: "40px", height: "40px", borderRadius: "6px", objectFit: "cover" }}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: "600", fontSize: "14px" }}>
                        {service.productTitle}
                      </div>
                      {service.variantTitle && (
                        <div style={{ fontSize: "12px", color: "#6d7175" }}>
                          {service.variantTitle}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: "12px" }}>
                      {service.duration} min
                    </div>
                  </div>
                ))}
              </s-grid>

              {/* Actions */}
              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", borderTop: "1px solid #e1e3e5", paddingTop: "16px" }}>
                <s-button onClick={handleCancelServicePicker}>Cancel</s-button>
                <s-button variant="primary" onClick={handleSaveServices}>
                  Save Services
                </s-button>
              </div>
            </s-grid>
          </div>
        </div>
      )}

      {/* Delete Service Confirmation Modal */}
      {showDeleteServiceModal && serviceToDelete && selectedEmployee && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            zIndex: 1001,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={handleCancelDeleteService}
        >
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "500px",
              width: "90%",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <s-grid gap="base">
              <s-text variant="headingMd">Remove Service</s-text>
              
              <s-text variant="bodyMd">
                Are you sure you want to remove this service from {selectedEmployee.name}?
              </s-text>
              
              <div style={{
                padding: "12px",
                backgroundColor: "#f6f6f7",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                gap: "12px"
              }}>
                {serviceToDelete.imageUrl && (
                  <img 
                    src={serviceToDelete.imageUrl} 
                    alt={serviceToDelete.productTitle}
                    style={{ width: "40px", height: "40px", borderRadius: "6px", objectFit: "cover" }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: "600", fontSize: "14px" }}>
                    {serviceToDelete.productTitle}
                  </div>
                  {serviceToDelete.variantTitle && (
                    <div style={{ fontSize: "12px", color: "#6d7175" }}>
                      {serviceToDelete.variantTitle}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: "12px" }}>
                  {serviceToDelete.duration} min
                </div>
              </div>

              <s-text variant="bodySm" color="subdued">
                This will remove the service from this employee's available services.
              </s-text>

              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <s-button onClick={handleCancelDeleteService}>Cancel</s-button>
                <s-button
                  variant="primary"
                  tone="critical"
                  onClick={handleConfirmDeleteService}
                >
                  Remove Service
                </s-button>
              </div>
            </s-grid>
          </div>
        </div>
      )}

      {/* Duplicate Schedule Modal */}
      {showDuplicateModal && scheduleToDuplicate && selectedEmployee && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            zIndex: 1001,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={handleCancelDuplicate}
        >
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "600px",
              width: "90%",
              maxHeight: "80vh",
              overflow: "auto",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <s-grid gap="base">
              <div>
                <s-heading>Duplicate Schedule</s-heading>
                <s-text variant="bodySm" color="subdued">
                  Copy schedule from {new Date(scheduleToDuplicate.date).toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric' 
                  })} ({scheduleToDuplicate.slots.length} slots) to other days
                </s-text>
              </div>

              <div style={{
                padding: "12px",
                backgroundColor: "#f0f9ff",
                borderRadius: "8px",
                border: "1px solid #bae6fd"
              }}>
                <s-text variant="bodySm">
                  💡 Select the days you want to copy this schedule to. Only open days (not weekends or closed days) are shown.
                </s-text>
              </div>

              <div>
                <s-text variant="bodyMd" fontWeight="semibold" style={{ marginBottom: "12px", display: "block" }}>
                  Select Days
                </s-text>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                  gap: "8px",
                  maxHeight: "300px",
                  overflow: "auto"
                }}>
                  {calendarDays.filter(dayInfo => {
                    if (dayInfo.isEmpty) return false;
                    // Exclude the source day and weekends
                    const sourceDate = new Date(scheduleToDuplicate.date).toISOString().split('T')[0];
                    const thisDate = dayInfo.date.toISOString().split('T')[0];
                    if (sourceDate === thisDate) return false;
                    if (dayInfo.isWeekend) return false;
                    // Check if day has time slots available
                    const slots = generateTimeSlots(dayInfo.date);
                    return slots.length > 0;
                  }).map((dayInfo) => {
                    const dateStr = dayInfo.date.toISOString().split('T')[0];
                    const isSelected = selectedDuplicateDays.includes(dateStr);
                    const hasExistingSchedule = getScheduleForDate(dayInfo.date, selectedEmployee?.id);
                    
                    return (
                      <div
                        key={dayInfo.key}
                        onClick={() => handleToggleDuplicateDay(dayInfo.date)}
                        style={{
                          padding: "10px",
                          borderRadius: "6px",
                          border: isSelected ? "2px solid #3b82f6" : "2px solid #e5e7eb",
                          backgroundColor: isSelected ? "#dbeafe" : "#ffffff",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                          textAlign: "center",
                          position: "relative"
                        }}
                      >
                        <div style={{ 
                          fontWeight: isSelected ? "600" : "500",
                          fontSize: "13px",
                          color: isSelected ? "#1e40af" : "#374151"
                        }}>
                          {dayInfo.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                        {hasExistingSchedule && (
                          <div style={{ 
                            fontSize: "10px", 
                            color: "#ef4444",
                            marginTop: "2px"
                          }}>
                            Will replace
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingTop: "8px",
                borderTop: "1px solid #e5e7eb"
              }}>
                <s-text variant="bodySm" color="subdued">
                  {selectedDuplicateDays.length} day{selectedDuplicateDays.length !== 1 ? 's' : ''} selected
                </s-text>
                <s-stack direction="inline" gap="small">
                  <s-button onClick={handleCancelDuplicate}>
                    Cancel
                  </s-button>
                  <s-button 
                    variant="primary"
                    onClick={handleConfirmDuplicate}
                    disabled={selectedDuplicateDays.length === 0}
                  >
                    Duplicate Schedule
                  </s-button>
                </s-stack>
              </div>
            </s-grid>
          </div>
        </div>
      )}

      {/* Delete Schedule Confirmation Modal */}
      {showDeleteScheduleModal && scheduleToDelete && selectedEmployee && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            zIndex: 1001,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={handleCancelDeleteSchedule}
        >
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "450px",
              width: "90%",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <s-grid gap="base">
              <s-text variant="headingMd">Delete Schedule</s-text>
              
              <s-text variant="bodyMd">
                Are you sure you want to delete the schedule for {selectedEmployee.name} on{" "}
                {new Date(scheduleToDelete.date).toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}?
              </s-text>
              
              <div style={{
                padding: "12px",
                backgroundColor: "#fef2f2",
                borderRadius: "8px",
                border: "1px solid #fecaca"
              }}>
                <s-text variant="bodySm" color="critical">
                  ⚠️ This will remove {scheduleToDelete.slots.length} time slot{scheduleToDelete.slots.length !== 1 ? 's' : ''} from this day.
                </s-text>
              </div>

              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <s-button onClick={handleCancelDeleteSchedule}>Cancel</s-button>
                <s-button
                  variant="primary"
                  tone="critical"
                  onClick={handleConfirmDeleteSchedule}
                >
                  Delete Schedule
                </s-button>
              </div>
            </s-grid>
          </div>
        </div>
      )}
    </s-page>
  );
}
