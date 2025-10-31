import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import ServiceForm from "../components/ServiceForm";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get store with services and resource types
  const store = await prisma.store.findUnique({
    where: { shop },
    include: {
      services: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        include: {
          resourceType: true,
        },
      },
      resourceTypes: {
        where: { isActive: true },
        orderBy: { name: "asc" },
      },
    },
  });

  // Serialize BigInt values
  const serializeData = (data) => {
    if (!data) return data;
    return JSON.parse(JSON.stringify(data, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
  };

  return { 
    services: serializeData(store?.services) || [], 
    resourceTypes: serializeData(store?.resourceTypes) || [],
    storeId: store?.id?.toString(),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const actionType = formData.get("action");

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

  if (actionType === "create") {
    const servicesData = formData.get("services");
    const services = JSON.parse(servicesData);

    // Create multiple services (one per variant or one for product)
    const createdServices = await Promise.all(
      services.map((svc) =>
        prisma.service.create({
          data: {
            productId: svc.productId,
            productTitle: svc.productTitle,
            variantId: svc.variantId || null,
            variantTitle: svc.variantTitle || null,
            imageUrl: svc.imageUrl || null,
            duration: svc.duration,
            resourceTypeId: svc.resourceTypeId ? BigInt(svc.resourceTypeId) : null,
            shop,
            storeId: store.id,
          },
        })
      )
    );

    return { success: true, services: createdServices };
  }

  if (actionType === "update") {
    const serviceId = formData.get("serviceId");
    const duration = parseInt(formData.get("duration"));

    await prisma.service.update({
      where: { id: BigInt(serviceId) },
      data: { duration, updatedAt: new Date() },
    });

    return { success: true, action: "update" };
  }

  if (actionType === "delete") {
    const serviceId = formData.get("serviceId");

    await prisma.service.update({
      where: { id: BigInt(serviceId) },
      data: { isActive: false },
    });

    return { success: true, action: "delete" };
  }

  return { success: false, error: "Invalid action" };
};

export default function ServicesPage() {
  const { services, resourceTypes } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [showForm, setShowForm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [deletingService, setDeletingService] = useState(null);
  const [editDuration, setEditDuration] = useState(30);
  const lastProcessedServiceId = useRef(null);
  const lastFetcherData = useRef(null);

  // Watch for fetcher completion and reload data
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success && fetcher.data !== lastFetcherData.current) {
      lastFetcherData.current = fetcher.data;
      
      if (fetcher.data.services) {
        const firstServiceId = fetcher.data.services[0]?.id;
        
        if (firstServiceId && firstServiceId !== lastProcessedServiceId.current) {
          lastProcessedServiceId.current = firstServiceId;
          setShowForm(false);
          revalidator.revalidate();
        }
      } else if (fetcher.data.action === "update") {
        setShowEditModal(false);
        setEditingService(null);
        revalidator.revalidate();
      } else if (fetcher.data.action === "delete") {
        setShowDeleteModal(false);
        setDeletingService(null);
        revalidator.revalidate();
      }
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  const isSubmitting = fetcher.state === "submitting";

  const handleCreateService = (servicesToCreate) => {
    fetcher.submit(
      { 
        action: "create", 
        services: JSON.stringify(servicesToCreate),
      },
      { method: "POST" }
    );
  };

  const handleEditService = (service) => {
    setEditingService(service);
    setEditDuration(service.duration);
    setShowEditModal(true);
  };

  const handleUpdateService = () => {
    if (editingService) {
      fetcher.submit(
        { 
          action: "update", 
          serviceId: editingService.id.toString(),
          duration: editDuration.toString(),
        },
        { method: "POST" }
      );
    }
  };

  const handleDeleteService = (service) => {
    setDeletingService(service);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = () => {
    if (deletingService) {
      fetcher.submit(
        { action: "delete", serviceId: deletingService.id.toString() },
        { method: "POST" }
      );
    }
  };

  const handleCancel = () => {
    setShowForm(false);
  };

  const handleCancelEdit = () => {
    setShowEditModal(false);
    setEditingService(null);
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
    setDeletingService(null);
  };

  // If showing form, render the form component
  if (showForm) {
    return (
      <ServiceForm 
        onCancel={handleCancel}
        onSubmit={handleCreateService}
        isSubmitting={isSubmitting}
        resourceTypes={resourceTypes}
      />
    );
  }

  // If editing, show edit page
  if (showEditModal && editingService) {
    return (
      <s-page heading="Edit Service Duration">
        <s-button slot="breadcrumb-actions" onClick={handleCancelEdit}>
          Services
        </s-button>
        <s-button slot="primary-action" variant="primary" onClick={handleUpdateService} disabled={isSubmitting || editDuration < 5} loading={isSubmitting}>
          Update
        </s-button>

        <s-section>
          <s-grid gap="base">
            <s-grid gap="small">
              <s-text variant="headingMd">Service Details</s-text>
              <s-text variant="bodyMd" fontWeight="semibold">
                {editingService.productTitle}
              </s-text>
              {editingService.variantTitle && (
                <s-text variant="bodySm" color="subdued">
                  {editingService.variantTitle}
                </s-text>
              )}
            </s-grid>

            <s-text-field
              label="Duration (minutes)"
              type="number"
              value={editDuration}
              onInput={(e) => setEditDuration(parseInt(e.currentTarget.value) || 0)}
              suffix="minutes"
              min="5"
              step="5"
            />
          </s-grid>
        </s-section>
      </s-page>
    );
  }

  // Otherwise render the service list
  return (
    <s-page heading="Services">
      <s-grid gap="base">
        <s-box>
          <s-grid gap="base">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <s-text variant="headingLg">Service List</s-text>
              <s-button variant="primary" onClick={() => setShowForm(true)}>
                Create Service
              </s-button>
            </div>

            {services.length === 0 ? (
              <s-box padding="large" background="subdued" borderRadius="base">
                <s-grid gap="base" justifyItems="center">
                  <s-text variant="bodyLg" color="subdued">
                    No services yet
                  </s-text>
                  <s-text variant="bodySm" color="subdued">
                    Create your first service to get started
                  </s-text>
                </s-grid>
              </s-box>
            ) : (
              <div>
                {/* Table Header */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "60px 2fr 1fr 1fr 1fr 120px",
                  gap: "16px",
                  padding: "12px 16px",
                  borderBottom: "2px solid #e1e3e5",
                  backgroundColor: "#fff"
                }}>
                  <s-text variant="bodySm" fontWeight="semibold">Image</s-text>
                  <s-text variant="bodySm" fontWeight="semibold">Product</s-text>
                  <s-text variant="bodySm" fontWeight="semibold">Variant</s-text>
                  <s-text variant="bodySm" fontWeight="semibold">Resource Type</s-text>
                  <s-text variant="bodySm" fontWeight="semibold">Duration</s-text>
                  <s-text variant="bodySm" fontWeight="semibold">Actions</s-text>
                </div>

                {/* Service Rows */}
                {services.map((service) => (
                  <div 
                    key={service.id.toString()}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "60px 2fr 1fr 1fr 1fr 120px",
                      gap: "16px",
                      padding: "16px",
                      borderBottom: "1px solid #e1e3e5",
                      alignItems: "center",
                      backgroundColor: "#fff"
                    }}
                  >
                    <div style={{ 
                      width: "40px", 
                      height: "40px", 
                      borderRadius: "8px", 
                      overflow: "hidden",
                      border: "1px solid #e1e3e5",
                      backgroundColor: "#f6f6f7",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}>
                      {service.imageUrl ? (
                        <img 
                          src={service.imageUrl} 
                          alt={service.productTitle}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <s-icon type="image" size="small" />
                      )}
                    </div>
                    
                    <s-text variant="bodyMd">
                      {service.productTitle}
                    </s-text>
                    
                    <div>
                      {service.variantTitle ? (
                        <span style={{
                          display: "inline-block",
                          padding: "4px 12px",
                          backgroundColor: "#d4f4dd",
                          color: "#108043",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: "500"
                        }}>
                          {service.variantTitle}
                        </span>
                      ) : (
                        <span style={{
                          display: "inline-block",
                          padding: "4px 12px",
                          backgroundColor: "#e3e5e7",
                          color: "#5c5f62",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: "500"
                        }}>
                          Default
                        </span>
                      )}
                    </div>

                    <div>
                      {service.resourceType ? (
                        <span style={{
                          display: "inline-block",
                          padding: "4px 12px",
                          backgroundColor: "#e0e7ff",
                          color: "#4338ca",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: "500"
                        }}>
                          {service.resourceType.name}
                        </span>
                      ) : (
                        <span style={{
                          display: "inline-block",
                          padding: "4px 12px",
                          backgroundColor: "#f3f4f6",
                          color: "#6b7280",
                          borderRadius: "12px",
                          fontSize: "12px",
                          fontWeight: "500"
                        }}>
                          None
                        </span>
                      )}
                    </div>

                    <s-text variant="bodySm">
                      {service.duration} min
                    </s-text>

                    <div style={{ display: "flex", gap: "4px" }}>
                      <button
                        onClick={() => handleEditService(service)}
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
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f6f6f7"}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#fff"}
                        title="Edit"
                      >
                        <s-icon type="edit" size="small" />
                      </button>
                      <button
                        onClick={() => handleDeleteService(service)}
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
                        title="Delete"
                      >
                        <s-icon type="delete" size="small" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </s-grid>
        </s-box>
      </s-grid>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && deletingService && (
        <div 
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000
          }}
          onClick={handleCancelDelete}
        >
          <div 
            style={{
              backgroundColor: "#fff",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "500px",
              width: "90%",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <s-grid gap="base">
              <s-text variant="headingMd">Delete Service</s-text>
              
              <s-text variant="bodyMd">
                Are you sure you want to delete this service?
              </s-text>
              
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-grid gap="small">
                  <s-text variant="bodyMd" fontWeight="semibold">
                    {deletingService.productTitle}
                  </s-text>
                  {deletingService.variantTitle && (
                    <s-text variant="bodySm" color="subdued">
                      {deletingService.variantTitle}
                    </s-text>
                  )}
                  <s-text variant="bodySm">
                    Duration: {deletingService.duration} minutes
                  </s-text>
                </s-grid>
              </s-box>

              <s-text variant="bodySm" color="subdued">
                This action cannot be undone.
              </s-text>

              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <s-button onClick={handleCancelDelete}>Cancel</s-button>
                <s-button
                  variant="primary"
                  tone="critical"
                  onClick={handleConfirmDelete}
                  disabled={isSubmitting}
                  loading={isSubmitting}
                >
                  Delete Service
                </s-button>
              </div>
            </s-grid>
          </div>
        </div>
      )}
    </s-page>
  );
}
