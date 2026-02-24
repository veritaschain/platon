import { NextResponse } from 'next/server'
import { SUPPORTED_MODELS } from '@/lib/connectors/types'

export async function GET() {
  return NextResponse.json({ models: SUPPORTED_MODELS })
}
