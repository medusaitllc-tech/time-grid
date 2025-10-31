import React, { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get store with resource types and resources
  const store = await prisma.store.findUnique({
    where: { shop },
    include: {
      resourceTypes: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        include: {
          resources: {
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  // Convert BigInt to string for JSON serialization
  const serializeData = (data) => {
    if (!data) return data;
    return JSON.parse(JSON.stringify(data, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
  };

  const serializedTypes = serializeData(store?.resourceTypes) || [];

  return { 
    resourceTypes: serializedTypes,
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

  // Resource Type Actions
  if (actionType === "createType") {
    const name = formData.get("name");

    const resourceType = await prisma.resourceType.create({
      data: {
        name,
        shop,
        storeId: store.id,
      },
    });

    return { success: true, resourceType };
  }

  if (actionType === "updateType") {
    const typeId = formData.get("typeId");
    const name = formData.get("name");

    await prisma.resourceType.update({
      where: { id: BigInt(typeId) },
      data: { 
        name,
        updatedAt: new Date() 
      },
    });

    return { success: true, action: "updateType" };
  }

  if (actionType === "deleteType") {
    const typeId = formData.get("typeId");

    await prisma.resourceType.update({
      where: { id: BigInt(typeId) },
      data: { isActive: false },
    });

    return { success: true, action: "deleteType" };
  }

  // Resource Actions
  if (actionType === "createResource") {
    const name = formData.get("name");
    const resourceTypeId = formData.get("resourceTypeId");

    const resource = await prisma.resource.create({
      data: {
        name,
        description: null,
        quantity: 1, // Default quantity
        shop,
        storeId: store.id,
        resourceTypeId: BigInt(resourceTypeId),
      },
    });

    return { success: true, resource };
  }

  if (actionType === "updateResource") {
    const resourceId = formData.get("resourceId");
    const name = formData.get("name");

    await prisma.resource.update({
      where: { id: BigInt(resourceId) },
      data: { 
        name,
        updatedAt: new Date() 
      },
    });

    return { success: true, action: "updateResource" };
  }

  if (actionType === "deleteResource") {
    const resourceId = formData.get("resourceId");

    await prisma.resource.update({
      where: { id: BigInt(resourceId) },
      data: { isActive: false },
    });

    return { success: true, action: "deleteResource" };
  }

  return { success: false, error: "Invalid action" };
};

export default function ResourcesPage() {
  const { resourceTypes, storeId } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  
  // Add global CSS for table row backgrounds
  React.useEffect(() => {
    const style = document.createElement('style');
    style.id = 'resource-table-styles';
    style.textContent = `
      .resource-type-row s-table-cell {
        background-color: #f6f6f7 !important;
      }
    `;
    document.head.appendChild(style);
    return () => {
      const existingStyle = document.getElementById('resource-table-styles');
      if (existingStyle) {
        document.head.removeChild(existingStyle);
      }
    };
  }, []);
  
  const [selectedType, setSelectedType] = useState(null);
  const [editingType, setEditingType] = useState(null);
  const [deletingType, setDeletingType] = useState(null);
  const [editingResource, setEditingResource] = useState(null);
  const [deletingResource, setDeletingResource] = useState(null);
  
  const [typeFormData, setTypeFormData] = useState({ name: "" });
  const [resourceFormData, setResourceFormData] = useState({
    name: "",
  });

  const lastProcessedId = useRef(null);

  // Auto-select first type if none selected
  useEffect(() => {
    if (!selectedType && resourceTypes.length > 0) {
      setSelectedType(resourceTypes[0]);
    }
  }, [resourceTypes, selectedType]);

  // Watch for fetcher completion
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      const data = fetcher.data;
      
      if (data.resourceType && data.resourceType.id !== lastProcessedId.current) {
        lastProcessedId.current = data.resourceType.id;
        setTypeFormData({ name: "" });
      } else if (data.resource && data.resource.id !== lastProcessedId.current) {
        lastProcessedId.current = data.resource.id;
        setResourceFormData({ name: "" });
      } else if (data.action) {
        setEditingType(null);
        setDeletingType(null);
        setEditingResource(null);
        setDeletingResource(null);
        setTypeFormData({ name: "" });
        setResourceFormData({ name: "" });
      }
      // Revalidate once after all state updates
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data]);

  const isSubmitting = fetcher.state === "submitting";

  // Resource Type Handlers
  const handleCreateType = () => {
    if (typeFormData.name.trim()) {
      fetcher.submit(
        { action: "createType", name: typeFormData.name },
        { method: "POST" }
      );
      const closeBtn = document.querySelector('[commandFor="add-type-modal"][command="--hide"]');
      if (closeBtn) closeBtn.click();
    }
  };

  const handleEditType = (type) => {
    setEditingType(type);
    setTypeFormData({ name: type.name });
  };

  const handleUpdateType = () => {
    if (editingType && typeFormData.name.trim()) {
      fetcher.submit(
        { 
          action: "updateType", 
          typeId: editingType.id,
          name: typeFormData.name 
        },
        { method: "POST" }
      );
      const closeBtn = document.querySelector('[commandFor="edit-type-modal"][command="--hide"]');
      if (closeBtn) closeBtn.click();
    }
  };

  const handleDeleteType = (type) => {
    setDeletingType(type);
  };

  const handleConfirmDeleteType = () => {
    if (deletingType) {
      fetcher.submit(
        { action: "deleteType", typeId: deletingType.id },
        { method: "POST" }
      );
      if (selectedType?.id === deletingType.id) {
        setSelectedType(null);
      }
      const closeBtn = document.querySelector('[commandFor="delete-type-modal"][command="--hide"]');
      if (closeBtn) closeBtn.click();
    }
  };

  // Resource Handlers
  const handleCreateResource = () => {
    if (selectedType && resourceFormData.name.trim()) {
      fetcher.submit(
        { 
          action: "createResource", 
          name: resourceFormData.name,
          resourceTypeId: selectedType.id,
        },
        { method: "POST" }
      );
      const closeBtn = document.querySelector('[commandFor="add-resource-modal"][command="--hide"]');
      if (closeBtn) closeBtn.click();
    }
  };

  const handleEditResource = (resource) => {
    setEditingResource(resource);
    setResourceFormData({
      name: resource.name,
    });
  };

  const handleUpdateResource = () => {
    if (editingResource && resourceFormData.name.trim()) {
      fetcher.submit(
        { 
          action: "updateResource", 
          resourceId: editingResource.id,
          name: resourceFormData.name,
        },
        { method: "POST" }
      );
      const closeBtn = document.querySelector('[commandFor="edit-resource-modal"][command="--hide"]');
      if (closeBtn) closeBtn.click();
    }
  };

  const handleDeleteResource = (resource) => {
    setDeletingResource(resource);
  };

  const handleConfirmDeleteResource = () => {
    if (deletingResource) {
      fetcher.submit(
        { action: "deleteResource", resourceId: deletingResource.id },
        { method: "POST" }
      );
      const closeBtn = document.querySelector('[commandFor="delete-resource-modal"][command="--hide"]');
      if (closeBtn) closeBtn.click();
    }
  };

  const selectedResources = selectedType?.resources || [];

  return (
    <s-page heading="Resources" inlineSize="small">
      <s-grid gap="large">
        {/* Header with Add Button */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <s-text variant="bodyMd" color="subdued">
            Organize and manage your bookable resources by type
          </s-text>
          <s-button 
            commandFor="add-type-modal" 
            command="--show" 
            variant="primary"
          >
            Add Resource Type
          </s-button>
        </div>

        {/* Resource Types & Resources Table */}
        <s-card>
          {resourceTypes.length === 0 ? (
            <s-box padding="extraLarge">
              <s-grid gap="base" justifyItems="center">
                <s-icon type="categories" size="large" />
                <s-text variant="headingMd" alignment="center">
                  No resource types yet
                </s-text>
                <s-text variant="bodyMd" color="subdued" alignment="center">
                  Create your first resource type to organize your bookable resources
                </s-text>
              </s-grid>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Name</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                  {resourceTypes.map((type) => (
                    <React.Fragment key={`type-${type.id}`}>
                      {/* Resource Type Row */}
                      <s-table-row class="resource-type-row">
                        <s-table-cell>
                          <s-stack direction="inline" gap="small" alignItems="center">
                            <s-icon type="folder" />
                            <s-text variant="bodyMd" fontWeight="semibold">
                              {type.name}
                            </s-text>
                            <s-badge tone="info">
                              {type.resources?.length || 0} resource{type.resources?.length !== 1 ? 's' : ''}
                            </s-badge>
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>
                          <s-stack direction="inline" gap="small" justifyContent="end">
                              <s-button
                                onClick={() => {
                                  setSelectedType(type);
                                  setTimeout(() => {
                                    const btn = document.querySelector('[data-open-add-resource]');
                                    if (btn) btn.click();
                                  }, 0);
                                }}
                                icon="add"
                                variant="secondary"
                              >
                                Add Resource
                              </s-button>
                              <s-button
                                onClick={() => {
                                  handleEditType(type);
                                  setTimeout(() => {
                                    const btn = document.querySelector('[data-open-edit-type]');
                                    if (btn) btn.click();
                                  }, 0);
                                }}
                                icon="edit"
                                variant="secondary"
                              />
                              <s-button
                                tone="critical"
                                onClick={() => {
                                  handleDeleteType(type);
                                  setTimeout(() => {
                                    const btn = document.querySelector('[data-open-delete-type]');
                                    if (btn) btn.click();
                                  }, 0);
                                }}
                                icon="delete"
                                variant="secondary"
                              />
                            </s-stack>
                        </s-table-cell>
                      </s-table-row>

                      {/* Resource Rows */}
                      {type.resources && type.resources.length > 0 && type.resources.map((resource) => (
                        <s-table-row key={`resource-${resource.id}`}>
                          <s-table-cell>
                            <s-stack direction="inline" gap="small" alignItems="center">
                              <s-box inlineSize="24px"></s-box>
                              <s-icon type="product" size="small" />
                              <s-text variant="bodySm">{resource.name}</s-text>
                            </s-stack>
                          </s-table-cell>
                          <s-table-cell>
                            <s-stack direction="inline" gap="small" justifyContent="end">
                              <s-button
                                onClick={() => {
                                  handleEditResource(resource);
                                  setTimeout(() => {
                                    const btn = document.querySelector('[data-open-edit-resource]');
                                    if (btn) btn.click();
                                  }, 0);
                                }}
                                icon="edit"
                                variant="tertiary"
                              />
                              <s-button
                                tone="critical"
                                onClick={() => {
                                  handleDeleteResource(resource);
                                  setTimeout(() => {
                                    const btn = document.querySelector('[data-open-delete-resource]');
                                    if (btn) btn.click();
                                  }, 0);
                                }}
                                icon="delete"
                                variant="tertiary"
                              />
                            </s-stack>
                          </s-table-cell>
                        </s-table-row>
                      ))}
                    </React.Fragment>
                  ))}
              </s-table-body>
            </s-table>
          )}
        </s-card>
      </s-grid>

      {/* Add Resource Type Modal */}
      <s-modal id="add-type-modal" heading="Add Resource Type" size="medium">
        <s-stack gap="base">
          <s-text-field
            label="Type Name"
            value={typeFormData.name}
            onInput={(e) => setTypeFormData({ name: e.currentTarget.value })}
            placeholder="e.g., Meeting Rooms, Equipment, Vehicles"
          />
        </s-stack>

        <s-button 
          slot="primary-action"
          onClick={handleCreateType} 
          variant="primary"
          disabled={!typeFormData.name.trim() || isSubmitting}
          loading={isSubmitting}
        >
          Add Type
        </s-button>
        <s-button 
          slot="secondary-actions"
          commandFor="add-type-modal" 
          command="--hide"
          variant="secondary" 
          disabled={isSubmitting}
        >
          Cancel
        </s-button>
      </s-modal>

      {/* Edit Resource Type Modal */}
      <s-modal id="edit-type-modal" heading="Edit Resource Type" size="medium">
        <s-stack gap="base">
          <s-text-field
            label="Type Name"
            value={typeFormData.name}
            onInput={(e) => setTypeFormData({ name: e.currentTarget.value })}
            placeholder="e.g., Meeting Rooms, Equipment, Vehicles"
          />
        </s-stack>

        <s-button 
          slot="primary-action"
          onClick={handleUpdateType} 
          variant="primary"
          disabled={!typeFormData.name.trim() || isSubmitting}
          loading={isSubmitting}
        >
          Update Type
        </s-button>
        <s-button 
          slot="secondary-actions"
          commandFor="edit-type-modal" 
          command="--hide"
          variant="secondary" 
          disabled={isSubmitting}
        >
          Cancel
        </s-button>
      </s-modal>

      {/* Delete Resource Type Modal */}
      <s-modal id="delete-type-modal" heading="Delete Resource Type">
        {deletingType && (
          <s-stack gap="base">
            <s-text variant="bodyMd">
              Are you sure you want to delete this resource type?
            </s-text>
            
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-grid gap="small">
                <s-text variant="bodyMd" fontWeight="semibold">
                  {deletingType.name}
                </s-text>
                <s-text variant="bodySm">
                  {deletingType.resources?.length || 0} resource(s)
                </s-text>
              </s-grid>
            </s-box>

            <s-text variant="bodySm" color="critical">
              All resources in this type will also be deleted. This action cannot be undone.
            </s-text>
          </s-stack>
        )}

        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={handleConfirmDeleteType}
          disabled={isSubmitting}
          loading={isSubmitting}
        >
          Delete Type
        </s-button>
        <s-button 
          slot="secondary-actions"
          commandFor="delete-type-modal" 
          command="--hide"
          variant="secondary" 
          disabled={isSubmitting}
        >
          Cancel
        </s-button>
      </s-modal>

      {/* Hidden trigger buttons */}
      <div style={{ display: 'none' }}>
        <s-button data-open-add-resource commandFor="add-resource-modal" command="--show"></s-button>
        <s-button data-open-edit-type commandFor="edit-type-modal" command="--show"></s-button>
        <s-button data-open-delete-type commandFor="delete-type-modal" command="--show"></s-button>
        <s-button data-open-edit-resource commandFor="edit-resource-modal" command="--show"></s-button>
        <s-button data-open-delete-resource commandFor="delete-resource-modal" command="--show"></s-button>
      </div>

      {/* Add Resource Modal */}
      <s-modal id="add-resource-modal" heading="Add New Resource" size="medium">
        <s-stack gap="base">
          <s-text-field
            label="Resource Name"
            value={resourceFormData.name}
            onInput={(e) => setResourceFormData({ ...resourceFormData, name: e.currentTarget.value })}
            placeholder="e.g., Meeting Room A, Projector, Laptop"
          />
        </s-stack>

        <s-button 
          slot="primary-action"
          onClick={handleCreateResource} 
          variant="primary"
          disabled={!resourceFormData.name.trim() || isSubmitting}
          loading={isSubmitting}
        >
          Add Resource
        </s-button>
        <s-button 
          slot="secondary-actions"
          commandFor="add-resource-modal" 
          command="--hide"
          variant="secondary" 
          disabled={isSubmitting}
        >
          Cancel
        </s-button>
      </s-modal>

      {/* Edit Resource Modal */}
      <s-modal id="edit-resource-modal" heading="Edit Resource" size="medium">
        <s-stack gap="base">
          <s-text-field
            label="Resource Name"
            value={resourceFormData.name}
            onInput={(e) => setResourceFormData({ ...resourceFormData, name: e.currentTarget.value })}
            placeholder="e.g., Meeting Room A, Projector, Laptop"
          />
        </s-stack>

        <s-button 
          slot="primary-action"
          onClick={handleUpdateResource} 
          variant="primary"
          disabled={!resourceFormData.name.trim() || isSubmitting}
          loading={isSubmitting}
        >
          Update Resource
        </s-button>
        <s-button 
          slot="secondary-actions"
          commandFor="edit-resource-modal" 
          command="--hide"
          variant="secondary" 
          disabled={isSubmitting}
        >
          Cancel
        </s-button>
      </s-modal>

      {/* Delete Resource Modal */}
      <s-modal id="delete-resource-modal" heading="Delete Resource">
        {deletingResource && (
          <s-stack gap="base">
            <s-text variant="bodyMd">
              Are you sure you want to delete this resource?
            </s-text>
            
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-grid gap="small">
                <s-text variant="bodyMd" fontWeight="semibold">
                  {deletingResource.name}
                </s-text>
                {deletingResource.description && (
                  <s-text variant="bodySm" color="subdued">
                    {deletingResource.description}
                  </s-text>
                )}
                <s-text variant="bodySm">
                  Quantity: {deletingResource.quantity}
                </s-text>
              </s-grid>
            </s-box>

            <s-text variant="bodySm" color="subdued">
              This action cannot be undone.
            </s-text>
          </s-stack>
        )}

        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={handleConfirmDeleteResource}
          disabled={isSubmitting}
          loading={isSubmitting}
        >
          Delete Resource
        </s-button>
        <s-button 
          slot="secondary-actions"
          commandFor="delete-resource-modal" 
          command="--hide"
          variant="secondary" 
          disabled={isSubmitting}
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}
