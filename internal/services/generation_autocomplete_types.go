package services

import "time"

type AutocompleteQuery struct {
	Input string `json:"input"`
	Limit int    `json:"limit"`
}

type AutocompleteSuggestion struct {
	Tag          string `json:"tag"`
	Category     int    `json:"category"`
	Popularity   int    `json:"popularity"`
	Alternative  string `json:"alternative"`
	InsertText   string `json:"insertText"`
	MatchedBy    string `json:"matchedBy"`
	MatchedValue string `json:"matchedValue"`
}

type completionDataset struct {
	path    string
	modTime time.Time
	size    int64
	entries []completionEntry
}

type completionEntry struct {
	Tag          string
	Category     int
	Popularity   int
	Alternatives []string
}

type autocompleteCandidate struct {
	entry        completionEntry
	rank         int
	matchedBy    string
	matchedValue string
}
