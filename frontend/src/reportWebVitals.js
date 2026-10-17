import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

// The server has no analytics endpoint (every page load used to post one and get
// an error back), so page-speed metrics are only logged during development.
function sendToAnalytics(metric) {
  if (process.env.NODE_ENV === 'development') {
    console.log(metric);
  }
}

function reportWebVitals() {
  getCLS(sendToAnalytics);  // Cumulative Layout Shift
  getFID(sendToAnalytics);  // First Input Delay
  getFCP(sendToAnalytics);  // First Contentful Paint
  getLCP(sendToAnalytics);  // Largest Contentful Paint
  getTTFB(sendToAnalytics); // Time to First Byte
}

export default reportWebVitals;
