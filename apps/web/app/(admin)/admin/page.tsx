'use client';

import React from 'react';
import Link from 'next/link';
import { Card } from '@sea-commodity-tycoon/ui';

const adminSections = [
  {
    title: 'Season Management',
    description: 'Start and end seasons, view season history',
    href: '/admin/seasons',
    icon: '📅',
  },
  {
    title: 'Event Management',
    description: 'Trigger and manage in-game events',
    href: '/admin/events',
    icon: '⚡',
  },
  {
    title: 'Game Config',
    description: 'Edit commodity and recipe configurations',
    href: '/admin/config',
    icon: '⚙️',
  },
  {
    title: 'Simulation',
    description: 'Run economy simulations and view results',
    href: '/admin/simulation',
    icon: '🧪',
  },
];

export default function AdminDashboardPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
      <p className="text-gray-600">
        Manage your game economy, seasons, events, and configuration.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {adminSections.map((section) => (
          <Link key={section.href} href={section.href}>
            <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-start gap-4">
                <span className="text-3xl">{section.icon}</span>
                <div>
                  <h3 className="font-semibold text-gray-900">{section.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">{section.description}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
