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
    openDays: "1,2,3,4,5",
    useResources: false,
    limitBookingWindow: false,
    bookingWindow: 30,
    limitAppointments: false,
    maxAppointmentsDisplayed: 10,
  };

  return { settings, hasSettings: !!store?.settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const workingHoursStart = formData.get("workingHoursStart");
  const workingHoursEnd = formData.get("workingHoursEnd");
  const openDays = formData.get("openDays");
  const useResources = formData.get("useResources") === "true";
  const limitBookingWindow = formData.get("limitBookingWindow") === "true";
  const bookingWindow = parseInt(formData.get("bookingWindow") || "30", 10);
  const limitAppointments = formData.get("limitAppointments") === "true";
  const maxAppointmentsDisplayed = parseInt(formData.get("maxAppointmentsDisplayed") || "10", 10);

  console.log("Saving settings:", { workingHoursStart, workingHoursEnd, openDays, useResources, limitBookingWindow, bookingWindow, limitAppointments, maxAppointmentsDisplayed });

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
      openDays: openDays.toString(),
      useResources,
      limitBookingWindow,
      bookingWindow,
      limitAppointments,
      maxAppointmentsDisplayed,
      updatedAt: new Date(),
    },
    create: {
      shop,
      storeId: store.id,
      workingHoursStart: workingHoursStart.toString(),
      workingHoursEnd: workingHoursEnd.toString(),
      openDays: openDays.toString(),
      useResources,
      limitBookingWindow,
      bookingWindow,
      limitAppointments,
      maxAppointmentsDisplayed,
    },
  });

  return { success: true };
};

export default function SettingsPage() {
  const { settings, hasSettings } = useLoaderData();
  const fetcher = useFetcher();

  const [workingHoursStart, setWorkingHoursStart] = useState(settings.workingHoursStart);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(settings.workingHoursEnd);
  const [useResources, setUseResources] = useState(settings.useResources || false);
  const [limitBookingWindow, setLimitBookingWindow] = useState(settings.limitBookingWindow || false);
  const [bookingWindow, setBookingWindow] = useState(settings.bookingWindow || 30);
  const [limitAppointments, setLimitAppointments] = useState(settings.limitAppointments || false);
  const [maxAppointmentsDisplayed, setMaxAppointmentsDisplayed] = useState(settings.maxAppointmentsDisplayed || 10);
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
        openDays: selectedDays.join(","),
        useResources: useResources.toString(),
        limitBookingWindow: limitBookingWindow.toString(),
        bookingWindow: bookingWindow.toString(),
        limitAppointments: limitAppointments.toString(),
        maxAppointmentsDisplayed: maxAppointmentsDisplayed.toString(),
      },
      { method: "POST" }
    );
  };

  const handleReset = () => {
    setWorkingHoursStart(settings.workingHoursStart);
    setWorkingHoursEnd(settings.workingHoursEnd);
    setUseResources(settings.useResources || false);
    setLimitBookingWindow(settings.limitBookingWindow || false);
    setBookingWindow(settings.bookingWindow || 30);
    setLimitAppointments(settings.limitAppointments || false);
    setMaxAppointmentsDisplayed(settings.maxAppointmentsDisplayed || 10);
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
            <s-text variant="headingMd">Resource Management</s-text>
            <s-text color="subdued">
              Enable resource allocation for appointments
            </s-text>
            
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={useResources}
                onChange={(e) => setUseResources(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              <s-text>Use Resources - Require resource allocation for bookings</s-text>
            </label>
            
            {useResources && (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-text variant="bodySm" color="subdued">
                  When enabled, customers will need to select an available resource when booking appointments. Make sure to add resources in the Resources page.
                </s-text>
              </s-box>
            )}
          </s-grid>
        </s-section>

        <s-section>
          <s-grid gap="base">
            <s-text variant="headingMd">Booking Window</s-text>
            <s-text color="subdued">
              Control how far in advance customers can book appointments
            </s-text>
            
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={limitBookingWindow}
                onChange={(e) => setLimitBookingWindow(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              <s-text>Limit booking window</s-text>
            </label>
            
            {limitBookingWindow && (
              <s-text-field
                label="Booking window (days)"
                type="number"
                value={bookingWindow.toString()}
                onInput={(e) => setBookingWindow(parseInt(e.currentTarget.value, 10) || 30)}
                min="1"
                max="365"
                helpText="Number of days in advance customers can book appointments"
              />
            )}
          </s-grid>
        </s-section>

        <s-section>
          <s-grid gap="base">
            <s-text variant="headingMd">Appointment Display Limit</s-text>
            <s-text color="subdued">
              Control how many appointments are shown to customers
            </s-text>
            
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={limitAppointments}
                onChange={(e) => setLimitAppointments(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              <s-text>Limit number of displayed appointments</s-text>
            </label>
            
            {limitAppointments && (
              <s-text-field
                label="Maximum appointments to display"
                type="number"
                value={maxAppointmentsDisplayed.toString()}
                onInput={(e) => setMaxAppointmentsDisplayed(parseInt(e.currentTarget.value, 10) || 10)}
                min="1"
                max="100"
                helpText="Customers will see a 'More' button to load additional appointments"
              />
            )}
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
