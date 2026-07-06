import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getClone, getLogs } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const cloneId = request.nextUrl.searchParams.get('cloneId');

    if (!cloneId) {
      return NextResponse.json(
        { success: false, error: 'cloneId required' },
        { status: 400 }
      );
    }

    const clone = getClone(cloneId);
    if (!clone) {
      return NextResponse.json(
        { success: false, error: 'Clone not found' },
        { status: 404 }
      );
    }

    const logs: string[] = [];

    // Try to get Docker logs
    try {
      const containerName = `legion-${clone.name.replace('-clone', '')}`;
      const dockerLogs = execSync(`docker logs ${containerName}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      logs.push(...dockerLogs.split('\n').filter(l => l.trim()));
    } catch (err) {
      logs.push(`[Docker logs not available]`);
    }

    // Get application logs from database
    const dbLogs = getLogs(cloneId, 50);
    logs.push(...dbLogs.map((log: any) => `[${log.type}] ${log.message}`));

    return NextResponse.json({
      success: true,
      logs: logs.slice(-100), // Last 100 logs
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
