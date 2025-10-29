import { useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get store with settings
  const store = await prisma.store.findUnique({
    where: { shop },
    include: {
      settings: true,
    },
  });

  // Return settings or default values
  const settings = store?.settings || {
    workingHoursStart: "09:00",
    workingHoursEnd: "17:00",
    timeSlotSize: 30,
    openDays: "1,2,3,4,5",
  };

  return { settings, hasSettings: !!store?.settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const workingHoursStart = formData.get("workingHoursStart");
  const workingHoursEnd = formData.get("workingHoursEnd");
  const timeSlotSize = parseInt(formData.get("timeSlotSize"));
  const slotType = formData.get("slotType");
  const openDays = formData.get("openDays");

  console.log("Saving settings:", { workingHoursStart, workingHoursEnd, timeSlotSize, slotType, openDays });

  // Get or create store
  let store = await prisma.store.findUnique({
    where: { shop },
  });

  if (!store) {
    store = await prisma.store.create({
      data: {
        shop,
        isActive: true,
      },
    });
  }

  // Upsert settings
  await prisma.settings.upsert({
    where: { storeId: store.id },
    update: {
      workingHoursStart: workingHoursStart.toString(),
      workingHoursEnd: workingHoursEnd.toString(),
      timeSlotSize,
      slotType: slotType.toString(),
      openDays: openDays.toString(),
      updatedAt: new Date(),
    },
    create: {
      shop,
      storeId: store.id,
      workingHoursStart: workingHoursStart.toString(),
      workingHoursEnd: workingHoursEnd.toString(),
      timeSlotSize,
      slotType: slotType.toString(),
      openDays: openDays.toString(),
    },
  });

  return { success: true };
};

export default function SettingsPage() {
  const { settings, hasSettings } = useLoaderData();
  const fetcher = useFetcher();

  const [workingHoursStart, setWorkingHoursStart] = useState(settings.workingHoursStart);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(settings.workingHoursEnd);
  const [timeSlotSize, setTimeSlotSize] = useState(settings.timeSlotSize);
  const [slotType, setSlotType] = useState(settings.slotType || "fixed");
  const [selectedDays, setSelectedDays] = useState(
    settings.openDays.split(",").map(Number)
  );

  const isSubmitting = fetcher.state === "submitting";
  const isSuccess = fetcher.state === "idle" && fetcher.data?.success;

  // Reset success message after save
  useEffect(() => {
    if (isSuccess) {
      // Update the original values to match current state
      // This will make the form clean again
    }
  }, [isSuccess]);

  const daysOfWeek = [
    { value: 0, label: "Sunday" },
    { value: 1, label: "Monday" },
    { value: 2, label: "Tuesday" },
    { value: 3, label: "Wednesday" },
    { value: 4, label: "Thursday" },
    { value: 5, label: "Friday" },
    { value: 6, label: "Saturday" },
  ];

  const timeSlotOptions = [
    { value: 15, label: "15 minutes" },
    { value: 30, label: "30 minutes" },
    { value: 45, label: "45 minutes" },
    { value: 60, label: "1 hour" },
  ];

  const toggleDay = (dayValue) => {
    if (selectedDays.includes(dayValue)) {
      setSelectedDays(selectedDays.filter((d) => d !== dayValue));
    } else {
      setSelectedDays([...selectedDays, dayValue].sort());
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    fetcher.submit(
      {
        workingHoursStart,
        workingHoursEnd,
        timeSlotSize: timeSlotSize.toString(),
        slotType,
        openDays: selectedDays.join(","),
      },
      { method: "POST" }
    );
  };

  const handleReset = () => {
    setWorkingHoursStart(settings.workingHoursStart);
    setWorkingHoursEnd(settings.workingHoursEnd);
    setTimeSlotSize(settings.timeSlotSize);
    setSlotType(settings.slotType || "fixed");
    setSelectedDays(settings.openDays.split(",").map(Number));
  };

  return (
    <s-page heading="Settings">
      {isSuccess && (
        <s-banner tone="success" dismissible>
          Settings saved successfully!
        </s-banner>
      )}

      <form data-save-bar onSubmit={handleSubmit} onReset={handleReset}>
        <s-section>
          <s-grid gap="base">
            <s-text variant="headingMd">Working Hours</s-text>
            <s-text color="subdued">
              Set your business operating hours for appointments
            </s-text>
            
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-text-field
                label="Start Time"
                type="time"
                value={workingHoursStart}
                onInput={(e) => setWorkingHoursStart(e.currentTarget.value)}
              />
              <s-text-field
                label="End Time"
                type="time"
                value={workingHoursEnd}
                onInput={(e) => setWorkingHoursEnd(e.currentTarget.value)}
              />
            </s-grid>
          </s-grid>
        </s-section>

        <s-section>
          <s-grid gap="base">
            <s-text variant="headingMd">Time Slot Configuration</s-text>
            <s-text color="subdued">
              Configure how appointment slots are managed
            </s-text>
            
            <s-grid gap="base">
              <s-grid gap="small">
                <s-text variant="bodyMd" fontWeight="medium">Slot Type</s-text>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="slotType"
                    value="fixed"
                    checked={slotType === "fixed"}
                    onChange={(e) => setSlotType(e.target.value)}
                    style={{ cursor: "pointer" }}
                  />
                  <s-text>Fixed - Same duration for all appointments</s-text>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="slotType"
                    value="variable"
                    checked={slotType === "variable"}
                    onChange={(e) => setSlotType(e.target.value)}
                    style={{ cursor: "pointer" }}
                  />
                  <s-text>Variable - Duration depends on service</s-text>
                </label>
              </s-grid>

              {slotType === "fixed" && (
                <div>
                  <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: "500" }}>
                    Slot Duration
                  </label>
                  <select
                    value={timeSlotSize}
                    onChange={(e) => setTimeSlotSize(parseInt(e.target.value))}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "14px",
                      border: "1px solid #c4cdd5",
                      borderRadius: "4px",
                      backgroundColor: "white",
                      cursor: "pointer",
                    }}
                  >
                    {timeSlotOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </s-grid>
          </s-grid>
        </s-section>

        <s-section>
          <s-grid gap="base">
            <s-text variant="headingMd">Open Days</s-text>
            <s-text color="subdued">
              Select the days your business is open
            </s-text>
            
            <s-grid gap="small">
              {daysOfWeek.map((day) => (
                <label key={day.value} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={selectedDays.includes(day.value)}
                    onChange={() => toggleDay(day.value)}
                    style={{ cursor: "pointer" }}
                  />
                  <s-text>{day.label}</s-text>
                </label>
              ))}
            </s-grid>
          </s-grid>
        </s-section>
      </form>
    </s-page>
  );
}
