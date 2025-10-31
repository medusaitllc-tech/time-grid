# Time Grid - Merchant Setup Guide

## 📋 Quick Setup (5 minutes)

### Step 1: Get Your App URL

When you run `shopify app dev`, you'll see output like this:

```
Preview URL: https://admin.shopify.com/store/your-store/apps/time-grid-1
App URL: https://metabolism-strikes-calculated-elevation.trycloudflare.com
```

**Copy the App URL** (the cloudflare one)

### Step 2: Add the Booking Calendar to Your Theme

1. **Go to Theme Editor**
   - Online Store → Themes → Customize

2. **Navigate to a Product Page**
   - Click "Products" → Select any product template

3. **Add the Booking Calendar Block**
   - Click "Add block" or "Add section"
   - Look for **"Booking Calendar"** under "Apps" or "Time Grid"
   - Drag it where you want it on the product page

4. **Configure the App URL**
   - Click on the "Booking Calendar" block
   - In the settings panel on the right, find **"App URL"**
   - Paste your app URL (e.g., `https://metabolism-strikes-calculated-elevation.trycloudflare.com`)
   - **Important**: Remove any trailing slashes

5. **Save**
   - Click "Save" in the top right

### Step 3: Configure a Product as a Service

1. **Go to Time Grid App**
   - Apps → Time Grid

2. **Add a Service**
   - Click "Services" in the navigation
   - Click "Add Service"
   - Select a product
   - Set the duration (e.g., 30 minutes)
   - Save

3. **Add Employees**
   - Click "Employees" in the navigation
   - Add employees who can provide the service
   - Assign services to each employee

4. **Configure Settings**
   - Click "Settings"
   - Set working hours (e.g., 9:00 AM - 5:00 PM)
   - Set open days (e.g., Monday-Friday)
   - Save

### Step 4: Test the Booking Calendar

1. **Go to your storefront**
   - Visit the product you configured as a service

2. **You should see:**
   - A booking calendar with date picker
   - Available time slots for the selected date
   - Employee names for each slot

## 🔧 Troubleshooting

### "Configuration Required" Warning

**Problem**: Yellow warning box saying "Configuration Required"

**Solution**: You haven't set the App URL in the theme editor settings
1. Go to theme editor
2. Click on the Booking Calendar block
3. Update the "App URL" setting with your actual app URL

### "This product is not available for booking"

**Problem**: Product doesn't show booking calendar

**Solution**: Product isn't configured as a service
1. Go to Time Grid app
2. Add the product as a service
3. Refresh the product page

### No Time Slots Available

**Problem**: Calendar shows but no time slots

**Possible causes**:
1. **No employees assigned** - Add employees and assign them to the service
2. **Store closed** - Check your working hours and open days in Settings
3. **Wrong date** - Try selecting a different date

### CORS Errors in Console

**Problem**: Browser console shows CORS errors

**Solution**: Make sure you're using the correct app URL from `shopify app dev`

## 📱 For Production

When you're ready to deploy to production:

1. **Deploy your app**
   ```bash
   shopify app deploy
   ```

2. **Update App URL in theme**
   - The app URL will change from cloudflare to your production URL
   - Update it in the theme editor settings

3. **Test thoroughly**
   - Test booking on different products
   - Test different dates and times
   - Test on mobile devices

## 🎨 Customization

### Styling

The booking calendar uses inline styles but you can override them in your theme's CSS:

```css
.timegrid-widget {
  /* Your custom styles */
}

.timegrid-slot {
  /* Customize time slot appearance */
}
```

### Block Settings

Available settings in theme editor:
- **App URL**: Your Time Grid app URL (required)

## 🔒 Security

The booking API is public (read-only) because customers need to see availability. However:

- ✅ CORS restricted to Shopify domains
- ✅ No sensitive data exposed
- ✅ Read-only (no data mutations)
- ✅ Shop domain validation

## 📞 Support

If you encounter issues:

1. Check browser console for errors (F12)
2. Verify app URL is correct
3. Ensure `shopify app dev` is running
4. Check that products are configured as services

## 🚀 Next Steps

- [ ] Configure all bookable products as services
- [ ] Add all staff members as employees
- [ ] Set up working hours and schedules
- [ ] Test booking flow end-to-end
- [ ] Deploy to production
