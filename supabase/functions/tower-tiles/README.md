# tower-tiles

Reads the public tile status from tiles.kovamaps.com (Cloudflare R2), which Tower's browser can't read
because R2 sends no CORS header. Returns the lane manifest summary and probes one tree and one building
tile (`?x=&y=`, zoom 14). Deploy from the Supabase dashboard (Edge Functions → tower-tiles), Verify JWT on.
No secrets.
