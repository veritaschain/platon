-- Enable Row Level Security on all application tables.
-- Prisma connects as the database owner (postgres), which bypasses RLS.
-- This blocks direct access via Supabase PostgREST (anon/authenticated roles).

ALTER TABLE "Room" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ModelRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssistantMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Handoff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrateResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HandoffTemplate" ENABLE ROW LEVEL SECURITY;
