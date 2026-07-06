import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { join } from 'path';
import { addClone, addLog } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { success: false, error: 'URL is required' },
        { status: 400 }
      );
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    // Extract domain from URL
    const urlObj = new URL(url);
    const domainName = urlObj.hostname.replace(/\./g, '-');
    const cloneName = `${domainName}-clone`;

    // Add to database
    const cloneId = addClone(cloneName, url, urlObj.hostname, 80, false);
    addLog(cloneId, 'generator', `Starting clone generation for ${url}`);

    try {
      // Run clone-perfect-engine tool
      const toolPath = join(
        process.cwd(),
        '..',
        '..',
        'scripts',
        'lib',
        'generators',
        'clone-perfect-engine.ts'
      );

      addLog(cloneId, 'generator', `Executing tool: ${toolPath}`);

      // Use ts-node to execute TypeScript
      const output = execSync(
        `npx ts-node "${toolPath}" --target "${url}" --output "../clones/${cloneName}"`,
        {
          cwd: join(process.cwd(), '..', '..'),
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 120000,
          env: { ...process.env, NODE_ENV: 'production' }
        }
      );

      addLog(cloneId, 'generator', `Tool output: ${output.substring(0, 200)}`);
      addLog(cloneId, 'generator', '✅ Clone generation completed');

      return NextResponse.json({
        success: true,
        cloneId,
        cloneName,
        message: `Clone generated successfully for ${url}`,
      });
    } catch (execError) {
      const errorMsg = `Tool execution failed: ${String(execError).substring(0, 200)}`;
      addLog(cloneId, 'error', errorMsg);

      return NextResponse.json(
        {
          success: false,
          cloneId,
          error: 'Clone generation started but tool execution had issues. Check logs.',
        },
        { status: 207 } // 207 Partial Success
      );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
