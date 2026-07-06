import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { join } from 'path';
import { getClone, updateCloneStatus, addLog } from '@/lib/db';

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
    const dockerComposePath = join(clonePath, 'docker-compose.yml');

    try {
      addLog(cloneId, 'docker', `Stopping container for ${clone.name}...`);

      // Execute docker compose down
      const output = execSync(
        `docker compose -f "${dockerComposePath}" down`,
        {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 30000,
          cwd: clonePath,
        }
      );

      updateCloneStatus(cloneId, 'stopped');
      addLog(cloneId, 'docker', `✅ Container stopped successfully`);
      addLog(cloneId, 'docker', `Output: ${output.substring(0, 200)}`);

      return NextResponse.json({
        success: true,
        message: `Container ${clone.name} stopped successfully`,
        output,
      });
    } catch (dockerError) {
      const errorMsg = String(dockerError);
      updateCloneStatus(cloneId, 'error');
      addLog(cloneId, 'docker', `❌ Failed to stop: ${errorMsg.substring(0, 200)}`);

      return NextResponse.json(
        {
          success: false,
          error: `Docker error: ${errorMsg.substring(0, 200)}`,
        },
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
