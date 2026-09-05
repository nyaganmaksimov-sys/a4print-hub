import express from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const service = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

const originalPost = express.application.post;

express.application.post = function patchedPost(path, ...handlers) {
  if (path === '/api/v1/pos/returns' && handlers.length) {
    const index = handlers.length - 1;
    const originalHandler = handlers[index];
    handlers[index] = async function selectedOperatorReturn(req, res, next) {
      try {
        const requestedId = String(req.body?.operator_id || '').trim();
        // Keep the same security model as sales: only ADMIN may choose another operator.
        if (requestedId && req.isAdmin && service) {
          const { data: operator, error } = await service
            .from('users')
            .select('id,auth_user_id,full_name,email,is_active')
            .eq('id', requestedId)
            .maybeSingle();
          if (error) throw error;
          if (operator?.is_active && operator.auth_user_id) {
            req.authUser = {
              ...(req.authUser || {}),
              id: operator.auth_user_id,
              email: operator.email || req.authUser?.email || null
            };
          }
        }
        return originalHandler(req, res, next);
      } catch (error) {
        return next(error);
      }
    };
  }
  return originalPost.call(this, path, ...handlers);
};
