import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import IssueDetailPanel from '../IssueDetailPanel';
import type { Ticket, Agent, IssueComment } from '../../types';

// IssueDetailPanel 내부에서 useAuth()를 사용하므로, 테스트에서는 AuthProvider 대신 mock 처리한다.
vi.mock('../../auth/AuthContext', () => {
  return {
    useAuth: () => ({
      token: null,
      user: null,
      selectedProjectId: null,
      projects: [],
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      selectProject: vi.fn(),
      refreshUser: vi.fn(),
    }),
  };
});

describe('IssueDetailPanel', () => {
  const mockTicket: Ticket = {
    id: 'test-1',
    issueId: 'issue-1',
    title: 'Test Issue',
    source: 'discord',
    createdAt: Date.now(),
    severity: 1,
    sentiment: 'neg',
    status: 'OPEN',
    assignedAgentId: 'agent-1',
    assignedAgentName: 'Test Agent'
  };

  const mockAgents: Agent[] = [
    {
      id: 'agent-1',
      name: 'Test Agent',
      status: 'available',
      handling: 0,
      todayResolved: 5,
      avgHandleSec: 300,
      channelFocus: ['PUBG PC'],
      isActive: true
    }
  ];

  const mockComments: IssueComment[] = [
    {
      id: 1,
      issueId: 'issue-1',
      body: 'Test comment',
      createdAt: new Date().toISOString(),
      authorId: 'agent-1',
      authorName: 'Test Agent'
    }
  ];

  const mockHandlers = {
    onClose: () => {},
    onStatusChange: () => {},
    onAssignAgent: () => {},
    onCommentChange: () => {},
    onSubmitComment: () => {}
  };

  it('renders issue title', () => {
    render(
      <IssueDetailPanel
        ticket={mockTicket}
        agents={mockAgents}
        comments={mockComments}
        commentsLoading={false}
        newComment=""
        submittingComment={false}
        {...mockHandlers}
      />
    );

    // 제목이 여러 영역(헤더/원문 등)에 반복 표기될 수 있으므로, 하나 이상 존재하면 통과
    expect(screen.getAllByText('Test Issue').length).toBeGreaterThan(0);
  });

  it('renders issue status', () => {
    render(
      <IssueDetailPanel
        ticket={mockTicket}
        agents={mockAgents}
        comments={mockComments}
        commentsLoading={false}
        newComment=""
        submittingComment={false}
        {...mockHandlers}
      />
    );

    // OPEN 상태는 UI에서 라벨로 표시됨
    expect(screen.getByText('미열람')).toBeInTheDocument();
  });

  it('renders comments', () => {
    render(
      <IssueDetailPanel
        ticket={mockTicket}
        agents={mockAgents}
        comments={mockComments}
        commentsLoading={false}
        newComment=""
        submittingComment={false}
        {...mockHandlers}
      />
    );

    expect(screen.getByText('Test comment')).toBeInTheDocument();
  });
});






