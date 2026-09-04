import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.A4PRINT_CONFIG || {};
const url = config.supabaseUrl || 'https://qgakliolffnwkymoqvzn.supabase.co';
const key = config.supabasePublishableKey || '';
const supabase = createClient(url, key);

const page = location.pathname.split('/').pop();
const publicPages = new Set(['login.html','register.html','pending.html']);
if (!publicPages.has(page)) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.replace('./login.html');
  } else if (page !== 'profile.html') {
    const { data, error } = await supabase.rpc('get_my_staff_profile');
    if (error || data?.status !== 'ACTIVE') {
      if (data?.status === 'UNREGISTERED') location.replace('./register.html');
      else location.replace('./pending.html');
    }
  }
}

export { supabase };
