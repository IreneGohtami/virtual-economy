import React from 'react';

export interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
}

export function Card({ title, children, className = '', padding = 'md' }: CardProps) {
  const paddingStyles: Record<string, string> = {
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
  };

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-200 ${paddingStyles[padding]} ${className}`}>
      {title && <h3 className="text-lg font-semibold text-gray-900 mb-3">{title}</h3>}
      {children}
    </div>
  );
}
