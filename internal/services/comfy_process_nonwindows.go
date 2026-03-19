//go:build !windows

package services

import "os/exec"

func configureComfyProcess(cmd *exec.Cmd) {
	_ = cmd
}
