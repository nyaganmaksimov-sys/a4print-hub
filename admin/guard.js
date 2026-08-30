import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.A4PRINT_CONFIG || {};
const url = config.supabaseUrl || 'https://qgakliolffnwkymoqvzn.supabase.co';
const key = config.supabasePublishableKey || '';
const supabase = createClient(url, key);

const page = location.pathname.split('/').pop();
if (page !== 'login.html') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) location.replace('./login.html');
}

export { supabase };
