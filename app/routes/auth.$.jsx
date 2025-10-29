import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { saveStoreInfo } from "../utils/store.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  // Save store information on install/authentication
  if (admin && session?.shop) {
    await saveStoreInfo(admin, session.shop);
  }

  return null;
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
