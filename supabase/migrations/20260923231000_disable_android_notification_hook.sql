drop trigger if exists notifications_native_push on public.notifications;
drop function if exists public.enqueue_native_notification_push();
drop function if exists public.notification_android_devices(uuid, uuid[]);
drop function if exists public.verify_notification_push_hook(text);
