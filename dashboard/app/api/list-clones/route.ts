import { NextRequest, NextResponse } from 'next/server';
import { getClones, getConfiguration, getLogs } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const clones = getClones();

    const enrichedClones = clones.map((clone: any) => {
      const config = getConfiguration(clone.id);
      const logs = getLogs(clone.id, 5);

      return {
        ...clone,
        config,
        logs,
      };
    });

    return NextResponse.json({
      success: true,
      clones: enrichedClones,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
