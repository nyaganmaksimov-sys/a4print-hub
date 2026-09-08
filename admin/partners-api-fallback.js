(()=>{
  if(window.__A4_PARTNERS_API_FALLBACK__)return;
  window.__A4_PARTNERS_API_FALLBACK__=true;
  // Legacy compatibility shim.
  // Partner management now always uses the protected A4PRINT HUB backend API.
  // Keep this filename temporarily because older cached config.js versions may
  // still request it, but never monkey-patch fetch or write directly to Supabase.
})();
