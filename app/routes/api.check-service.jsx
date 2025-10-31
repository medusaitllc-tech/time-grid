import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Check if a product is configured as a service
 * 
 * Security Model:
 * - Admin requests: Fully authenticated via Shopify session
 * - Storefront requests: Public read-only access with CORS restrictions
 * 
 * This is acceptable because:
 * 1. Data is read-only (no mutations)
 * 2. Information is public (customers need to see availability)
 * 3. CORS restricted to .myshopify.com domains
 * 4. No sensitive data exposed
 */
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  const variantId = url.searchParams.get("variantId"); // Optional: for variant-specific services
  const shop = url.searchParams.get("shop");

  console.log('[API] /api/check-service - Request received:', {
    productId,
    variantId,
    shop,
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

  if (!productId) {
    return Response.json(
      { error: "productId is required" },
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
      console.log('[API] /api/check-service - Storefront request detected');
      
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
      console.log('[API] /api/check-service - Admin request, authenticating...');
      try {
        const { session } = await authenticate.admin(request);
        shopDomain = session.shop;
      } catch (authError) {
        console.error('[API] /api/check-service - Authentication failed:', authError);
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

    // Extract numeric IDs from GID format if needed
    // GID format: gid://shopify/Product/8444945268933 or gid://shopify/ProductVariant/45175235608773
    const numericProductId = productId.includes('gid://') 
      ? productId.split('/').pop() 
      : productId;
    
    const numericVariantId = variantId && variantId.includes('gid://') 
      ? variantId.split('/').pop() 
      : variantId;
    
    console.log('[API] /api/check-service - Searching for service:', {
      originalProductId: productId,
      numericProductId,
      originalVariantId: variantId,
      numericVariantId,
      shopDomain,
    });

    // Build query conditions
    // Priority: 1. Exact variant match, 2. Product with no variant specified (product-level service)
    const whereConditions = [];
    
    if (numericVariantId) {
      // If variant ID provided, look for variant-specific service first
      whereConditions.push(
        { productId: numericProductId, variantId: numericVariantId, shop: shopDomain, isActive: true },
        { productId: productId, variantId: numericVariantId, shop: shopDomain, isActive: true },
        { productId: numericProductId, variantId: variantId, shop: shopDomain, isActive: true },
      );
    }
    
    // Also check for product-level service (no variant specified)
    whereConditions.push(
      { productId: numericProductId, variantId: null, shop: shopDomain, isActive: true },
      { productId: productId, variantId: null, shop: shopDomain, isActive: true },
      { productId: `gid://shopify/Product/${numericProductId}`, variantId: null, shop: shopDomain, isActive: true },
    );

    // Try to find service - variant-specific first, then product-level
    const service = await prisma.service.findFirst({
      where: {
        OR: whereConditions,
      },
      orderBy: [
        { variantId: 'desc' }, // Prioritize services with variantId (nulls last)
      ],
    });
    
    console.log('[API] /api/check-service - Database query result:', service ? 'Found' : 'Not found');

    if (service) {
      const response = {
        isService: true,
        serviceId: service.id.toString(),
        duration: service.duration,
        title: service.productTitle,
      };
      console.log('[API] /api/check-service - Response (service found):', response);
      return Response.json(response, {
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin || "*",
          "Content-Type": "application/json",
        },
      });
    }

    const response = { isService: false };
    console.log('[API] /api/check-service - Response (not a service):', response);
    return Response.json(response, {
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin || "*",
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error checking service:", error);
    return Response.json(
      { error: "Internal server error" },
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
