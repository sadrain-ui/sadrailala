import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function POST(request: NextRequest) {
  try {
    const { cloneName } = await request.json();
    const clonePath = join(process.cwd(), '..', 'clones', cloneName);

    const dockerComposePath = join(clonePath, 'docker-compose.yml');
    const nginxPath = join(clonePath, 'nginx.conf');

    const dockerCompose = readFileSync(dockerComposePath, 'utf-8');
    const nginx = readFileSync(nginxPath, 'utf-8');

    return NextResponse.json({
      success: true,
      files: {
        dockerCompose,
        nginx,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
