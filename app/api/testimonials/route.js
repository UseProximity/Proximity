import { NextResponse } from "next/server";
import connectMongo from "@/libs/mongoose";
import Testimonial from "@/models/Testimonial";

export async function GET() {
  await connectMongo();
  const testimonials = await Testimonial.find().sort({ createdAt: 1 }).lean();
  return NextResponse.json(testimonials);
}
