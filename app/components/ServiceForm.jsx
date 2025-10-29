import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

export default function ServiceForm({ onCancel, onSubmit, isSubmitting }) {
  const shopify = useAppBridge();
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [variants, setVariants] = useState([]);
  const [defaultDuration, setDefaultDuration] = useState(30);

  const handleOpenProductPicker = async () => {
    const selection = await shopify.resourcePicker({ type: 'product' });
    
    if (selection && selection.length > 0) {
      const product = selection[0];
      setSelectedProduct(product);
      
      // If product has variants, set them up with default duration
      // Check if it's just a single "Default Title" variant (treat as no variants)
      if (product.variants && product.variants.length > 0) {
        const hasOnlyDefaultVariant = product.variants.length === 1 && 
          (product.variants[0].title === "Default Title" || product.variants[0].title === "Default");
        
        if (hasOnlyDefaultVariant) {
          setVariants([]);
        } else {
          setVariants(
            product.variants.map((variant) => ({
              id: variant.id,
              title: variant.title,
              duration: defaultDuration,
            }))
          );
        }
      } else {
        setVariants([]);
      }
    }
  };

  const handleVariantDurationChange = (variantId, duration) => {
    setVariants(
      variants.map((v) =>
        v.id === variantId ? { ...v, duration: parseInt(duration) || 0 } : v
      )
    );
  };

  const handleSubmit = () => {
    if (!selectedProduct) return;

    const servicesToCreate = [];

    if (variants.length > 0) {
      // Create service for each variant
      variants.forEach((variant) => {
        servicesToCreate.push({
          productId: selectedProduct.id,
          productTitle: selectedProduct.title,
          variantId: variant.id,
          variantTitle: variant.title,
          imageUrl: variant.image || selectedProduct.images?.[0]?.originalSrc || null,
          duration: variant.duration,
        });
      });
    } else {
      // Create single service for product
      servicesToCreate.push({
        productId: selectedProduct.id,
        productTitle: selectedProduct.title,
        variantId: null,
        variantTitle: null,
        imageUrl: selectedProduct.images?.[0]?.originalSrc || null,
        duration: defaultDuration,
      });
    }

    onSubmit(servicesToCreate);
  };

  return (
    <s-page heading="Create service">
      <s-button slot="primary-action" variant="primary" onClick={handleSubmit} disabled={isSubmitting || !selectedProduct} loading={isSubmitting}>
        Add Service
      </s-button>
      <s-button slot="breadcrumb-actions" onClick={onCancel}>
        Cancel
      </s-button>

      {!selectedProduct ? (
        <s-section>
          <s-grid gap="base">
            <s-text variant="headingMd">Select a Product</s-text>
            <s-text variant="bodySm" color="subdued">
              Choose a product from your store to create a service
            </s-text>
            <div>
              <s-button variant="primary" onClick={handleOpenProductPicker}>
                Select Product
              </s-button>
            </div>
          </s-grid>
        </s-section>
      ) : (
        <>
          {/* Selected Product Section */}
          <s-section>
            <s-grid gap="base">
              <s-text variant="headingMd">Selected Product</s-text>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                {/* Product Image */}
                <div style={{ 
                  width: "60px", 
                  height: "60px", 
                  borderRadius: "8px", 
                  overflow: "hidden",
                  border: "1px solid #e1e3e5",
                  backgroundColor: "#f6f6f7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0
                }}>
                  {selectedProduct.images?.[0]?.originalSrc ? (
                    <img 
                      src={selectedProduct.images[0].originalSrc} 
                      alt={selectedProduct.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <s-icon type="image" size="small" />
                  )}
                </div>
                
                {/* Product Info */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
                  <s-text variant="bodyLg" fontWeight="semibold">
                    {selectedProduct.title}
                  </s-text>
                  <s-button variant="plain" onClick={handleOpenProductPicker}>
                    Change product
                  </s-button>
                </div>
              </div>
            </s-grid>
          </s-section>

          {/* Duration Configuration Section */}
          <s-section>
            {variants.length === 0 ? (
              <s-grid gap="base">
                <s-text variant="headingMd">Duration</s-text>
                <div 
                  style={{ 
                    display: "grid", 
                    gridTemplateColumns: "1fr 200px", 
                    gap: "16px", 
                    alignItems: "center" 
                  }}
                >
                  <s-text variant="bodyMd">
                    {selectedProduct.title}
                  </s-text>
                  <s-text-field
                    type="number"
                    value={defaultDuration}
                    onInput={(e) => setDefaultDuration(parseInt(e.currentTarget.value) || 30)}
                    suffix="minutes"
                    min="5"
                    step="5"
                  />
                </div>
              </s-grid>
            ) : (
              <s-grid gap="base">
                <s-grid gap="small">
                  <s-text variant="headingMd">Set duration for each variant</s-text>
                  <s-text variant="bodySm" color="subdued">
                    Configure the duration for each product variant
                  </s-text>
                </s-grid>
                <s-grid gap="base">
                  {variants.map((variant) => (
                    <div 
                      key={variant.id}
                      style={{ 
                        display: "grid", 
                        gridTemplateColumns: "1fr 200px", 
                        gap: "16px", 
                        alignItems: "center" 
                      }}
                    >
                      <s-text variant="bodyMd">
                        {variant.title}
                      </s-text>
                      <s-text-field
                        type="number"
                        value={variant.duration}
                        onInput={(e) =>
                          handleVariantDurationChange(variant.id, e.currentTarget.value)
                        }
                        suffix="minutes"
                        min="5"
                        step="5"
                      />
                    </div>
                  ))}
                </s-grid>
              </s-grid>
            )}
          </s-section>
        </>
      )}
    </s-page>
  );
}
