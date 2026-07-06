import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { join } from 'path';
import { getClone, updateCloneStatus, addLog } from '@/lib/db';
import { findAvailablePort, recordPort } from '@/lib/port-manager';
import { readFileSync, writeFileSync } from 'fs';

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
      addLog(cloneId, 'docker', `Starting container for ${clone.name}...`);

      // Find available port
      const port = findAvailablePort();
      recordPort(cloneId, port);
      addLog(cloneId, 'docker', `Allocated port: ${port}`);

      // Update docker-compose.yml with dynamic port
      let dockerCompose = readFileSync(dockerComposePath, 'utf-8');
      dockerCompose = dockerCompose.replace(
        /ports:\s*\n\s*-\s*"(\d+):80"/,
        `ports:\n      - "${port}:80"`
      );
      writeFileSync(dockerComposePath, dockerCompose);
      addLog(cloneId, 'docker', `Updated port mapping: ${port}:80`);

      // Execute docker compose up
      const output = execSync(
        `docker compose -f "${dockerComposePath}" up -d`,
        {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 30000,
          cwd: clonePath,
        }
      );

      updateCloneStatus(cloneId, 'running');
      addLog(cloneId, 'docker', `✅ Container started successfully`);
      addLog(cloneId, 'docker', `Output: ${output.substring(0, 200)}`);

      return NextResponse.json({
        success: true,
        message: `Container ${clone.name} started successfully`,
        output,
      });
    } catch (dockerError) {
      const errorMsg = String(dockerError);
      updateCloneStatus(cloneId, 'error');
      addLog(cloneId, 'docker', `❌ Failed to start: ${errorMsg.substring(0, 200)}`);

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
