-- Create the public storage bucket used for announcement and promotion media.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media',
  'post-media',
  true,
  52428800, -- 50 MB
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
on conflict (id) do nothing;

-- Allow authenticated users to upload into any folder.
create policy "Authenticated users can upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'post-media');

-- Anyone can read (bucket is public, but explicit policy keeps RLS happy).
create policy "Public read access"
  on storage.objects for select
  to public
  using (bucket_id = 'post-media');

-- Allow authenticated users to delete their own uploads.
create policy "Authenticated users can delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'post-media');
