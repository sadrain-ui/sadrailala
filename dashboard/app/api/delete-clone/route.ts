import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { rmSync } from 'fs';
import { join } from 'path';
import { getClone, deleteClone, addLog } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { cloneId } = await request.json();

    const clone = getClone(cloneId);
    if (!clone) {
      return NextResponse.json(
        { success: false, error: 'Clone not found' },
        { status: 404 }
      );
    }

    const clonePath = join(process.cwd(), '..', 'clones', clone.name);

    try {
      // Stop container if running
      try {
        const dockerComposePath = join(clonePath, 'docker-compose.yml');
        execSync(`docker compose -f "${dockerComposePath}" down`, {
          stdio: 'pipe',
          timeout: 10000,
          cwd: clonePath,
        });
      } catch (e) {
        // Container might not exist
      }

      // Delete clone directory
      rmSync(clonePath, { recursive: true, force: true });

      // Delete from database
      deleteClone(cloneId);

      return NextResponse.json({
        success: true,
        message: `Clone ${clone.name} deleted successfully`,
      });
    } catch (error) {
      return NextResponse.json(
        { success: false, error: `Failed to delete: ${String(error)}` },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
