// Supabase connection. Find both values in Supabase:
// Project Settings → API → "Project URL" and the "anon public" key.
// The anon key is meant to be public; the database rules in
// supabase/migrations decide what guests can do.
// Leave them empty to run the page in demo mode (data stays in this browser).
window.BKT_CONFIG = {
  supabaseUrl: "https://keoygnewbucwgpnlzlaq.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtlb3lnbmV3YnVjd2dwbmx6bGFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5NjMyODksImV4cCI6MjEwNzUzOTI4OX0.HOh5cPJkrg96Zf6MgJKXEvWmr7Zif85QW5kLUriI_QY",
};
