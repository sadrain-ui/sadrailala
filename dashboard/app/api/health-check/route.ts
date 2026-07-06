import { NextRequest, NextResponse } from 'next/server';
import { healthChecker } from '@/lib/health-check';
import { withAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  return withAuth(request, async (req, user) => {
    try {
      const issues = await healthChecker.runHealthCheck();

      const summary = {
        total: issues.length,
        critical: issues.filter(i => i.severity === 'critical').length,
        warning: issues.filter(i => i.severity === 'warning').length,
        info: issues.filter(i => i.severity === 'info').length,
        autoFixable: issues.filter(i => i.autoFixable).length,
      };

      return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        summary,
        issues,
      });
    } catch (error) {
      return NextResponse.json(
        { success: false, error: String(error) },
        { status: 500 }
      );
    }
  });
}

export async function POST(request: NextRequest) {
  return withAuth(request, async (req, user) => {
    try {
      const { issueId } = await req.json();

      if (!issueId) {
        return NextResponse.json(
          { success: false, error: 'issueId required' },
          { status: 400 }
        );
      }

      const success = await healthChecker.autoFix(issueId);

      if (success) {
        const issues = await healthChecker.runHealthCheck();
        return NextResponse.json({
          success: true,
          message: `Fixed issue: ${issueId}`,
          issues,
        });
      } else {
        return NextResponse.json(
          { success: false, error: 'Could not auto-fix this issue' },
          { status: 400 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        { success: false, error: String(error) },
        { status: 500 }
      );
    }
  });
}
