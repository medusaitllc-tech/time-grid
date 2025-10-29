import { useEffect, useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { redirect } from "react-router";

export const loader = async ({ request }) => {
  const { authenticate, BASIC_PLAN, PREMIUM_PLAN } = await import("../shopify.server");
  const prisma = (await import("../db.server")).default;
  
  try {
    // Use authenticate.admin for plan selection page (no billing required)
    // Other protected pages should use billing.require() instead
    const { billing, session } = await authenticate.admin(request);
    const url = new URL(request.url);
    
    console.log(`📄 Plan page loaded for shop: ${session.shop}`);
    
    // Check if returning from billing confirmation
    const charge_id = url.searchParams.get("charge_id");
    const subscriptionPlan = url.searchParams.get("SubscriptionPlan");
    
    if (charge_id && subscriptionPlan) {
      console.log("✅ Billing confirmed - charge_id:", charge_id, "plan:", subscriptionPlan);
      
      // Get subscription details from Shopify
      const billingCheck = await billing.check({
        plans: [BASIC_PLAN, PREMIUM_PLAN],
        isTest: true
      });
      
      if (billingCheck.hasActivePayment && billingCheck.appSubscriptions?.[0]) {
        const shopifySubscription = billingCheck.appSubscriptions[0];
        
        // Delete old subscription records for this shop
        await prisma.subscription.deleteMany({
          where: { shop: session.shop }
        });
        
        // Create new subscription record
        await prisma.subscription.create({
          data: {
            shop: session.shop,
            subscriptionId: shopifySubscription.id,
            planName: shopifySubscription.name,
            amount: shopifySubscription.lineItems?.[0]?.price?.amount || 0,
            status: 'ACTIVE',
            isTest: shopifySubscription.test || false,
            chargeId: charge_id,
            activatedAt: new Date()
          }
        });

    return {
      shop: session.shop,
      currentSubscription:  {
        planName: shopifySubscription.name,
        amount: shopifySubscription.lineItems?.[0]?.price?.amount || 0,
        activatedAt: new Date(),
        isTest: shopifySubscription.test || false,
        chargeId: charge_id,
      } ,
      plans: {
        [BASIC_PLAN]: {
          name: BASIC_PLAN,
          price: 9.99,
          features: [
            "Up to 100 products",
            "Basic analytics",
            "Email support",
            "Standard templates"
          ]
        },
        [PREMIUM_PLAN]: {
          name: PREMIUM_PLAN,
          price: 29.99,
          features: [
            "Unlimited products",
            "Advanced analytics",
            "Priority support 24/7",
            "Premium templates",
            "Custom branding",
            "API access"
          ]
        }
      },
      showSuccess: url.searchParams.get("success") === "true"
    };

        
        console.log('✅ Subscription saved to database');
      }else{
        console.log('❌ ---------------------No active subscription found');
      }
      
        return {
        shop: session.shop,
        currentSubscription:  {
            planName: shopifySubscription.name,
            amount: shopifySubscription.lineItems?.[0]?.price?.amount || 0,
            activatedAt: new Date(),
            isTest: shopifySubscription.test || false,
            chargeId: charge_id,
        } ,
        plans: {
            [BASIC_PLAN]: {
            name: BASIC_PLAN,
            price: 9.99,
            features: [
                "Up to 100 products",
                "Basic analytics",
                "Email support",
                "Standard templates"
            ]
            },
            [PREMIUM_PLAN]: {
            name: PREMIUM_PLAN,
            price: 29.99,
            features: [
                "Unlimited products",
                "Advanced analytics",
                "Priority support 24/7",
                "Premium templates",
                "Custom branding",
                "API access"
            ]
            }
        },
        showSuccess: url.searchParams.get("success") === "true"
        };
    }
    
    // Get current subscription from database
    const dbSubscription = await prisma.subscription.findFirst({
      where: {
        shop: session.shop,
        status: 'ACTIVE'
      },
      orderBy: {
        activatedAt: 'desc'
      }
    });
    
    console.log("📋 Current subscription:", dbSubscription ? dbSubscription.planName : 'None');
    
    return {
      shop: session.shop,
      currentSubscription: dbSubscription ? {
        planName: dbSubscription.planName,
        amount: dbSubscription.amount,
        activatedAt: dbSubscription.activatedAt,
        isTest: dbSubscription.isTest
      } : null,
      plans: {
        [BASIC_PLAN]: {
          name: BASIC_PLAN,
          price: 9.99,
          features: [
            "Up to 100 products",
            "Basic analytics",
            "Email support",
            "Standard templates"
          ]
        },
        [PREMIUM_PLAN]: {
          name: PREMIUM_PLAN,
          price: 29.99,
          features: [
            "Unlimited products",
            "Advanced analytics",
            "Priority support 24/7",
            "Premium templates",
            "Custom branding",
            "API access"
          ]
        }
      },
      showSuccess: url.searchParams.get("success") === "true"
    };
  } catch (error) {
    console.error("❌ Loader error:", error);
    throw error;
  }
};

export const action = async ({ request }) => {
  const { authenticate, BASIC_PLAN, PREMIUM_PLAN } = await import("../shopify.server");
  
  try {
    const { billing, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const planName = formData.get("planName");
    
    console.log(`🎯 Subscribe action - Plan: ${planName}, Shop: ${session.shop}`);
    
    // Validate plan
    if (![BASIC_PLAN, PREMIUM_PLAN].includes(planName)) {
      return { error: `Invalid plan: ${planName}` };
    }
    
    // Build return URL using Shopify admin format
    const shop = session.shop;
    const appHandle = process.env.APP_HANDLE;
    const shopName = shop.replace('.myshopify.com', '');
    const returnUrl = `https://admin.shopify.com/store/${shopName}/apps/${appHandle}/app/plan?SubscriptionPlan=${encodeURIComponent(planName)}`;

    // Request billing - this will throw a redirect response
    await billing.request({
      plan: planName,
      isTest: true,
      returnUrl: returnUrl
    });
    
    // Should not reach here
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Billing error:`, error);
    
    // Check if it's a 401 with billing confirmation URL
    if (error.status === 401 && error.headers) {
      const confirmationUrl = error.headers.get?.('x-shopify-api-request-failure-reauthorize-url');
      
      if (confirmationUrl) {
        console.log('🔄 Got billing confirmation URL:', confirmationUrl);
        return {
          confirmationUrl: confirmationUrl,
          needsRedirect: true
        };
      }
    }
    
    return {
      error: error.message || "Failed to process subscription request"
    };
  }
};

export default function PlanPage() {
  const { shop, currentSubscription, plans, showSuccess } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [selectedPlan, setSelectedPlan] = useState(null);
  
  const isSubmitting = navigation.state === "submitting";
  
  // Handle redirect to billing confirmation using open()
  useEffect(() => {
    if (actionData?.needsRedirect && actionData?.confirmationUrl) {
      console.log('🔄 Redirecting to billing confirmation:', actionData.confirmationUrl);
      
      // Use open() to navigate outside iframe
      if (typeof open === 'function') {
        open(actionData.confirmationUrl, '_top');
      } else {
        window.open(actionData.confirmationUrl, '_top');
      }
    }
  }, [actionData?.needsRedirect, actionData?.confirmationUrl]);
  
  return (
    <s-page large  heading="Choose Your Plan"  >
      {/* Success Message */}
      {showSuccess && (
        <s-banner tone="success">
          <s-text variant="body-md">
            ✅ <strong>Success!</strong> Your subscription has been activated.
          </s-text>
        </s-banner>
      )}
      
      {/* Error Message */}
      {actionData?.error && (
        <s-banner tone="critical">
          <s-text variant="body-md">
            ❌ <strong>Error:</strong> {actionData.error}
          </s-text>
        </s-banner>
      )}
      <s-section>
        <s-paragraph>
          Select a plan that fits your business. You can upgrade or downgrade at any time.
        </s-paragraph>
      </s-section>
      
      {/* Plan Cards */}
      <s-stack direction="inline" gap="large">
        {Object.entries(plans).map(([planKey, plan]) => {
          const isCurrentPlan = currentSubscription?.planName === planKey;
          const isProcessing = isSubmitting && selectedPlan === planKey;
          
          return (
            <s-section>
            <s-box 
              key={planKey}
              padding="large" 
            //   borderWidth="base" 
            //   borderRadius="base"
            //   background="surface"
            >
              <s-stack direction="block" gap="large" alignment="center">
                {/* Plan Header */}
                <s-stack direction="block" gap="tight" alignment="center">
                  <s-badge tone={planKey === Object.keys(plans)[1] ? "success" : undefined}>
                    {planKey.replace(" Plan", "")}
                  </s-badge>
                  <s-text variant="heading-2xl" fontWeight="bold">${plan.price}</s-text>
                  <s-text variant="body-sm" tone="subdued">per month</s-text>
                </s-stack>
                
                <s-divider />
                
                {/* Features */}
                <s-stack direction="block" gap="base" alignment="start" style={{ width: '100%' }}>
                  <s-unordered-list gap="tight">
                    {plan.features.map((feature, index) => (
                      <s-list-item key={index}>
                        <s-inline-stack gap="tight" alignment="center">
                          <s-text>✓</s-text>
                          <s-text>{feature}</s-text>
                        </s-inline-stack>
                      </s-list-item>
                    ))}
                  </s-unordered-list>
                </s-stack>
                
                {/* Subscribe Button */}
                <Form method="post" style={{ width: '100%' }}>
                  <input type="hidden" name="planName" value={planKey} />
                  
                  <s-button 
                    type="submit"
                    variant="primary"
                    onClick={() => setSelectedPlan(planKey)}
                    disabled={isCurrentPlan || isSubmitting}
                    style={{ 
                      width: '100%',
                      padding: '12px 24px',
                      fontSize: '16px',
                      fontWeight: '500',
                      border: 'none',
                      borderRadius: '6px',
                      backgroundColor: isCurrentPlan ? '#e0e0e0' : '#008060',
                      color: 'white',
                      cursor: isCurrentPlan || isSubmitting ? 'not-allowed' : 'pointer',
                      opacity: isSubmitting && !isProcessing ? 0.6 : 1
                    }}
                  >
                    {isCurrentPlan 
                      ? 'Current Plan' 
                      : isProcessing 
                        ? 'Processing...' 
                        : `Subscribe to ${planKey.replace(" Plan", "")}`
                    }
                  </s-button>
                </Form>
              </s-stack>
            </s-box>
            </s-section>
          );
        })}
      </s-stack>
    </s-page>
  );
}