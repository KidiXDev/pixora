package services

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"
)

func (s *GenerationService) QueueText2Image(req GenerationRequest) (*QueueGenerationResponse, error) {
	if s.config == nil {
		return nil, fmt.Errorf("missing config manager")
	}

	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "txt2img"
	}
	if mode != "txt2img" {
		return nil, fmt.Errorf("only txt2img queue is supported for now")
	}

	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, fmt.Errorf("prompt is required")
	}
	req = normalizeGenerationRequest(req)

	jobID := strings.TrimSpace(req.RequestID)
	if jobID == "" {
		jobID = fmt.Sprintf("job-%d", time.Now().UnixNano())
	}

	job := &GenerationQueueJob{
		JobID:    jobID,
		Mode:     mode,
		Prompt:   prompt,
		State:    generationQueueStateQueued,
		QueuedAt: time.Now().Format(time.RFC3339),
		req:      req,
	}

	s.queueMu.Lock()
	if _, exists := s.jobs[job.JobID]; exists {
		s.queueMu.Unlock()
		return nil, fmt.Errorf("generation request id already exists")
	}
	s.jobs[job.JobID] = job
	s.queue = append(s.queue, job)
	position := len(s.queue)
	s.queueMu.Unlock()

	s.emitGenerationStatus(GenerationStatus{
		PromptID:  job.JobID,
		State:     generationQueueStateQueued,
		Progress:  0,
		Message:   "queued generation job",
		StartedAt: job.QueuedAt,
	})

	s.notifyQueueWorker()

	return &QueueGenerationResponse{
		JobID:    job.JobID,
		Position: position,
		State:    job.State,
	}, nil
}

func (s *GenerationService) ListGenerationQueue() []GenerationQueueJob {
	s.queueMu.Lock()
	defer s.queueMu.Unlock()

	items := make([]GenerationQueueJob, 0, len(s.jobs))
	for _, job := range s.jobs {
		items = append(items, GenerationQueueJob{
			JobID:      job.JobID,
			Mode:       job.Mode,
			Prompt:     job.Prompt,
			State:      job.State,
			QueuedAt:   job.QueuedAt,
			StartedAt:  job.StartedAt,
			FinishedAt: job.FinishedAt,
			Error:      job.Error,
			PromptID:   job.PromptID,
		})
	}

	sort.Slice(items, func(i int, j int) bool {
		return items[i].QueuedAt > items[j].QueuedAt
	})

	return items
}

func (s *GenerationService) CancelGenerationJob(jobID string) error {
	trimmed := strings.TrimSpace(jobID)
	if trimmed == "" {
		return fmt.Errorf("job id is required")
	}

	s.queueMu.Lock()
	job, exists := s.jobs[trimmed]
	if !exists {
		s.queueMu.Unlock()
		return fmt.Errorf("generation job not found")
	}

	job.canceled = true
	comfyPromptID := strings.TrimSpace(job.comfyPromptID)
	isRunning := job.State == generationQueueStateRunning
	if job.cancel != nil {
		job.cancel()
	}

	if job.State == generationQueueStateQueued || job.State == generationQueueStateRunning {
		job.State = generationQueueStateCanceled
		job.Error = "canceled"
		job.FinishedAt = time.Now().Format(time.RFC3339)
	}
	s.queueMu.Unlock()

	if isRunning && s.config != nil {
		cfg := s.config.GetComfyUIConfig()
		baseURL := buildComfyBaseURL(cfg)
		if err := interruptComfyGeneration(baseURL, comfyPromptID); err != nil {
			log.Printf("[pixora] Failed to interrupt ComfyUI generation for job=%s prompt=%s: %v", trimmed, comfyPromptID, err)
		}
	}

	s.emitGenerationStatus(GenerationStatus{
		PromptID:  trimmed,
		State:     generationQueueStateCanceled,
		Progress:  0,
		Message:   "generation canceled",
		Error:     "canceled",
		StartedAt: job.StartedAt,
	})

	return nil
}

func (s *GenerationService) notifyQueueWorker() {
	select {
	case s.queueWakeupCh <- struct{}{}:
	default:
	}
}

func (s *GenerationService) processQueue() {
	for {
		job := s.dequeueNextRunnableJob()
		if job == nil {
			<-s.queueWakeupCh
			continue
		}

		ctx, cancel := context.WithCancel(context.Background())
		s.queueMu.Lock()
		if job.canceled {
			job.State = generationQueueStateCanceled
			job.Error = "canceled"
			job.FinishedAt = time.Now().Format(time.RFC3339)
			s.queueMu.Unlock()
			continue
		}
		job.cancel = cancel
		job.State = generationQueueStateRunning
		job.StartedAt = time.Now().Format(time.RFC3339)
		s.queueMu.Unlock()

		result, err := s.generateText2ImageInternal(ctx, job.req, job.JobID, func(promptID string) {
			s.queueMu.Lock()
			if trackedJob, ok := s.jobs[job.JobID]; ok {
				trackedJob.comfyPromptID = strings.TrimSpace(promptID)
			}
			s.queueMu.Unlock()
		})
		cancel()

		s.queueMu.Lock()
		job.cancel = nil
		job.comfyPromptID = ""
		job.FinishedAt = time.Now().Format(time.RFC3339)
		if job.canceled {
			job.State = generationQueueStateCanceled
			job.Error = "canceled"
		} else if err != nil {
			job.State = generationQueueStateError
			job.Error = err.Error()
		} else {
			job.State = generationQueueStateCompleted
			job.PromptID = result.PromptID
		}
		s.queueMu.Unlock()
	}
}

func (s *GenerationService) dequeueNextRunnableJob() *GenerationQueueJob {
	s.queueMu.Lock()
	defer s.queueMu.Unlock()

	for len(s.queue) > 0 {
		job := s.queue[0]
		s.queue = s.queue[1:]
		if job == nil {
			continue
		}
		if job.State != generationQueueStateQueued {
			continue
		}
		return job
	}

	return nil
}
