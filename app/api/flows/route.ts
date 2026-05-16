import { NextResponse } from 'next/server';
import { listFlows } from '@/lib/conversations';

export async function GET() {
  return NextResponse.json({ flows: listFlows() });
}
