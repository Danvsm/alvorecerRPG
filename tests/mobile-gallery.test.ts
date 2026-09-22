import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Android gallery queue survives reboot, app update and app resume", () => {
  const manifest = read("android-app/app/src/main/AndroidManifest.xml");
  const scheduler = read("android-app/app/src/main/java/com/alvorecer/rpg/sync/SyncScheduler.kt");
  const receiver = read("android-app/app/src/main/java/com/alvorecer/rpg/sync/BootReceiver.kt");
  const activity = read("android-app/app/src/main/java/com/alvorecer/rpg/MainActivity.kt");
  assert.match(manifest, /RECEIVE_BOOT_COMPLETED/);
  assert.match(receiver, /ACTION_BOOT_COMPLETED/);
  assert.match(receiver, /ACTION_MY_PACKAGE_REPLACED/);
  assert.match(scheduler, /NetworkType\.CONNECTED/);
  assert.match(scheduler, /OriginalRequestWorker/);
  assert.match(activity, /app_opened/);
  assert.match(activity, /app_resumed/);
});

test("original upload queue resumes both requested and interrupted uploads", () => {
  const route = read("supabase/functions/alvorecer-api/mobile-gallery.ts");
  const worker = read("android-app/app/src/main/java/com/alvorecer/rpg/sync/GalleryWorkers.kt");
  assert.match(route, /\.in\("status", \["requested", "uploading"\]\)/);
  assert.match(worker, /Result\.retry\(\)/);
  assert.match(worker, /pendingFcmToken/);
});

test("gallery transport is master-only, private and deduplicated", () => {
  const migration = read("supabase/migrations/20260922062735_master_mobile_gallery.sql");
  const route = read("supabase/functions/alvorecer-api/mobile-gallery.ts");
  assert.match(migration, /alvorecer_private\.mobile_gallery_devices/);
  assert.match(migration, /mobile_gallery_one_active_request/);
  assert.match(migration, /where status in \('requested','uploading','ready'\)/);
  assert.match(migration, /revoke all .* from public, anon, authenticated/);
  assert.match(migration, /'master-gallery-thumbnails'.*false/s);
  assert.match(migration, /'master-gallery-originals'.*false/s);
  assert.match(route, /await master\(req, campaign\)/);
  assert.match(route, /x-device-token/);
  assert.match(route, /createSignedUploadUrl/);
  assert.match(route, /createSignedUrl\(request\.original_path, 300/);
});

test("gallery FCM message is data-only and creates no visual notification", () => {
  const route = read("supabase/functions/alvorecer-api/mobile-gallery.ts");
  const service = read("android-app/app/src/main/java/com/alvorecer/rpg/sync/GalleryMessagingService.kt");
  assert.match(route, /data: \{ kind: "gallery_original_requested"/);
  assert.doesNotMatch(route, /notification:\s*\{/);
  assert.match(service, /SyncScheduler\.resumeNow/);
  assert.doesNotMatch(service, /NotificationManager|NotificationCompat/);
});
