import { NextResponse } from "next/server";
import connectMongo from "@/libs/mongoose";
import Dorm from "@/models/Dorm";

export const dynamic = "force-dynamic";

export async function GET() {
  await connectMongo();
  const dorms = await Dorm.find().lean();
  return NextResponse.json(dorms);
}
