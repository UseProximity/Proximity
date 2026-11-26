/*
 * Which database an admin billing route reads (Wyatt, 2026-11-06): the admin
 * dashboard's dev/prod switch, sent as the x-db-target header like the other admin
 * views. Billing is also tied to this site's Stripe and Documenso keys, so a site
 * only changes its own environment's billing data: production's on
 * useproximity.org, dev's on staging and local. The other environment is
 * read-only here.
 *
 *   adminBillingDb(req)   { db, target, own, writable }
 *   readOnlyResponse(ctx) the 409 a write to the other environment answers
 */
import { NextResponse } from "next/server";
import supabase, { getSupabaseClient } from "@/lib/supabase";
import { isProdData } from "@/lib/appEnv";

export const ownBillingTarget = () => (isProdData() ? "prod" : "dev");

export function adminBillingDb(req) {
  const asked = req?.headers?.get?.("x-db-target");
  const own = ownBillingTarget();
  const target = asked === "prod" || asked === "dev" ? asked : own;
  return { db: target === own ? supabase : getSupabaseClient(target), target, own, writable: target === own };
}

export function readOnlyResponse({ target }) {
  const where = target === "prod" ? "the production site (useproximity.org)" : "staging or a local copy";
  return NextResponse.json(
    {
      error: `This is ${target === "prod" ? "production" : "dev"} billing, shown read-only here. Make changes on ${where}.`,
      code: "read_only_env",
    },
    { status: 409 }
  );
}
