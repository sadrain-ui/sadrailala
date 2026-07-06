import { NextRequest, NextResponse } from 'next/server';
import { getLogs } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const cloneId = request.nextUrl.searchParams.get('cloneId');
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100');

    if (!cloneId) {
      return NextResponse.json(
        { success: false, error: 'cloneId required' },
        { status: 400 }
      );
    }

    const logs = getLogs(cloneId, limit);

    return NextResponse.json({
      success: true,
      logs: logs.map((log: any) => ({
        timestamp: log.timestamp,
        type: log.type,
        message: log.message,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
