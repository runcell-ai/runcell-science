-- Codex assistant messages carry a phase (commentary vs final_answer) on the
-- completed thread item. Persist it, plus a turn-level final-response
-- projection replicating the Codex SDK's final-answer semantics.
-- NULL phase = provider did not supply one (legacy models, Claude).

ALTER TABLE agent_messages ADD COLUMN phase TEXT
  CHECK (phase IN ('commentary', 'final_answer') OR phase IS NULL);

ALTER TABLE agent_turns ADD COLUMN final_response TEXT;
ALTER TABLE agent_turns ADD COLUMN final_message_id TEXT;
