'use client';

import React from 'react';
import Link from 'next/link';
import { Card } from '@sea-commodity-tycoon/ui';

export interface OnboardingProgress {
  hasSpecialty: boolean;
  hasLand: boolean;
  hasFactory: boolean;
  hasWorker: boolean;
}

interface OnboardingFlowProps {
  progress: OnboardingProgress;
  specialty: string | null;
}

const STEPS = [
  {
    key: 'hasLand',
    number: 1,
    title: 'Claim Your Land',
    description: 'Explore the map and purchase tiles to place your first factory.',
    href: '/map',
    icon: '🗺️',
    cta: 'Go to Map',
  },
  {
    key: 'hasFactory',
    number: 2,
    title: 'Build a Factory',
    description: 'Construct a factory on your purchased land to start producing commodities.',
    href: '/factories',
    icon: '🏭',
    cta: 'Build Factory',
  },
  {
    key: 'hasWorker',
    number: 3,
    title: 'Hire an Employee',
    description: 'Hire an employee and assign them to your factory to begin production.',
    href: '/workers',
    icon: '👷',
    cta: 'Hire Employee',
  },
] as const;

export function OnboardingFlow({ progress, specialty }: OnboardingFlowProps) {
  const completedCount = [progress.hasLand, progress.hasFactory, progress.hasWorker].filter(Boolean).length;

  // All onboarding done
  if (completedCount === 3) return null;

  // Determine the current active step
  const currentStepIndex = !progress.hasLand ? 0 : !progress.hasFactory ? 1 : 2;

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Getting Started</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Your specialty is <span className="font-medium text-blue-700">{specialty}</span>. Follow these steps to start producing.
            </p>
          </div>
          <div className="text-sm text-gray-400 font-medium">
            {completedCount}/3
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${(completedCount / 3) * 100}%` }}
            role="progressbar"
            aria-valuenow={completedCount}
            aria-valuemin={0}
            aria-valuemax={3}
            aria-label="Onboarding progress"
          />
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {STEPS.map((step, idx) => {
            const isCompleted = progress[step.key as keyof OnboardingProgress];
            const isCurrent = idx === currentStepIndex;
            const isLocked = idx > currentStepIndex;

            return (
              <div
                key={step.key}
                className={`flex items-center gap-4 p-3 rounded-lg border transition-all ${
                  isCompleted
                    ? 'border-green-200 bg-green-50'
                    : isCurrent
                    ? 'border-blue-200 bg-blue-50 shadow-sm'
                    : 'border-gray-100 bg-gray-50 opacity-60'
                }`}
              >
                {/* Step icon/status */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    isCompleted
                      ? 'bg-green-500 text-white'
                      : isCurrent
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span className="text-lg" aria-hidden="true">{step.icon}</span>
                  )}
                </div>

                {/* Step content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-400 uppercase">Step {step.number}</span>
                    {isCompleted && <span className="text-xs text-green-600 font-medium">Completed</span>}
                  </div>
                  <p className={`text-sm font-semibold ${isCompleted ? 'text-green-800' : 'text-gray-900'}`}>
                    {step.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>
                </div>

                {/* CTA */}
                {isCurrent && !isCompleted && (
                  <Link
                    href={step.href}
                    className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    {step.cta}
                  </Link>
                )}
                {isLocked && (
                  <span className="shrink-0 text-xs text-gray-400">🔒</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
