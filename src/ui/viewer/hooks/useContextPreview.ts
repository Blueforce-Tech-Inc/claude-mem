import { useState, useEffect, useCallback } from 'react';
import type { Settings } from '../types';

interface UseContextPreviewResult {
  preview: string;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  projects: string[];
  selectedProject: string | null;
  setSelectedProject: (project: string) => void;
}

export function useContextPreview(settings: Settings): UseContextPreviewResult {
  const [preview, setPreview] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  // Fetch projects on mount
  useEffect(() => {
    async function fetchProjects() {
      try {
        const response = await fetch('/api/projects');
        const data = await response.json();
        if (data.projects && data.projects.length > 0) {
          setProjects(data.projects);
          setSelectedProject(data.projects[0]); // Default to first project
        }
      } catch (err) {
        console.error('Failed to fetch projects:', err);
      }
    }
    fetchProjects();
  }, []);

  const refresh = useCallback(async () => {
    if (!selectedProject) {
      setPreview('No project selected');
      return;
    }

    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams({
      project: selectedProject
    });

    // Add filter parameters from settings
    const observationTypes = settings.CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES?.trim();
    const concepts = settings.CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS?.trim();
    // Use CLAUDE_MEM_CONTEXT_OBSERVATIONS (from UI "Observations" input) for maxObservations
    const maxObservations = settings.CLAUDE_MEM_CONTEXT_OBSERVATIONS?.trim();
    // Use CLAUDE_MEM_CONTEXT_SESSION_COUNT (from UI "Sessions" input) for sessionCount
    const sessionCount = settings.CLAUDE_MEM_CONTEXT_SESSION_COUNT?.trim();
    // Use CLAUDE_MEM_CONTEXT_FULL_COUNT (from UI Display "Count" input) for fullCount
    const fullCount = settings.CLAUDE_MEM_CONTEXT_FULL_COUNT?.trim();

    if (observationTypes) {
      params.set('observationTypes', observationTypes);
    }
    if (concepts) {
      params.set('concepts', concepts);
    }
    if (maxObservations) {
      params.set('maxObservations', maxObservations);
    }
    if (sessionCount) {
      params.set('sessionCount', sessionCount);
    }
    if (fullCount) {
      params.set('fullCount', fullCount);
    }

    const response = await fetch(`/api/context/preview?${params}`);
    const text = await response.text();

    if (response.ok) {
      setPreview(text);
    } else {
      setError('Failed to load preview');
    }

    setIsLoading(false);
  }, [selectedProject, settings]);

  // Debounced refresh when settings or selectedProject change
  useEffect(() => {
    const timeout = setTimeout(() => {
      refresh();
    }, 300);
    return () => clearTimeout(timeout);
  }, [settings, refresh]);

  return { preview, isLoading, error, refresh, projects, selectedProject, setSelectedProject };
}
