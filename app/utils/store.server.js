import prisma from "../db.server";

/**
 * Save or update store information in the database
 * @param {Object} admin - Shopify admin GraphQL client
 * @param {string} shop - Shop domain
 */
export async function saveStoreInfo(admin, shop) {
  try {
    // Fetch shop information from Shopify
    const response = await admin.graphql(
      `#graphql
        query {
          shop {
            name
            email
            primaryDomain {
              url
            }
            currencyCode
            ianaTimezone
            plan {
              publicDisplayName
            }
          }
        }
      `
    );

    const { data } = await response.json();
    
    if (data?.shop) {
      const shopData = data.shop;
      
      // Upsert store information
      await prisma.store.upsert({
        where: { shop },
        update: {
          name: shopData.name,
          email: shopData.email,
          domain: shopData.primaryDomain?.url,
          currency: shopData.currencyCode,
          timezone: shopData.ianaTimezone,
          planName: shopData.plan?.publicDisplayName,
          isActive: true,
          updatedAt: new Date(),
        },
        create: {
          shop,
          name: shopData.name,
          email: shopData.email,
          domain: shopData.primaryDomain?.url,
          currency: shopData.currencyCode,
          timezone: shopData.ianaTimezone,
          planName: shopData.plan?.publicDisplayName,
          isActive: true,
          installedAt: new Date(),
        },
      });

      console.log(`Store information saved for ${shop}`);
    }
  } catch (error) {
    console.error(`Error saving store information for ${shop}:`, error);
    // Don't throw - we don't want to break the auth flow if this fails
  }
}

/**
 * Get store information from database
 * @param {string} shop - Shop domain
 * @returns {Promise<Object|null>} Store information or null
 */
export async function getStoreInfo(shop) {
  try {
    return await prisma.store.findUnique({
      where: { shop },
    });
  } catch (error) {
    console.error(`Error fetching store information for ${shop}:`, error);
    return null;
  }
}
