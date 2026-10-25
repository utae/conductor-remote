
on tabGroups()
	-- Every tab group in the main window, shallowest first, at whatever depth it sits.
	-- It used to stop at the first depth that had one, which held while the chat strip and
	-- the terminal strip were siblings. Conductor 0.92.0 split them: the terminal strip
	-- (Setup / Run / Terminal N) is at depth 7 beside the workspace header, the chat strip
	-- at depth 11 beside the composer. Stopping at depth 7 returned the terminal strip
	-- alone, which scored zero against the chat count and title, so every send failed with
	-- "couldn't identify the chat tab strip" (relay log 2026-10-25, five sends, none landed).
	-- Order stays shallowest-first on purpose: the workspace header is a sibling of the
	-- terminal strip, so `assertWorkspace(item 1 of strips)` still finds it, while the
	-- composer is beside the chat strip and is reached through `composerPane`.
	my requireWindow()
	set found to my collectTabGroups(30)
	-- Nothing found means a node the narrow pass refused to open held them (the pass skips
	-- anything wider than 30 children, which is what keeps the sidebar out and the pass
	-- near 2s instead of 8s). Look once more without that limit rather than report no strip.
	if (count of found) is 0 then set found to my collectTabGroups(100000)
	return found
end tabGroups

on collectTabGroups(widthLimit)
	-- Level-order, depth <= 14, and at most 400 nodes. Leaves are not opened: a button or a
	-- line of text has no tab strip under it, and asking costs an Apple event each. The web
	-- area's own scroll-area host is *not* a leaf, which is what stopped an earlier attempt
	-- at depth 4. Never descends into the transcript: it hangs off a node wider than the
	-- limit, and the node cap bounds the wide pass.
	set mainIdx to my mainWindowIndex()
	set found to {}
	set visited to 0
	set leafRoles to {"AXStaticText", "AXButton", "AXPopUpButton", "AXLink", "AXTextArea", "AXRadioButton", "AXListMarker", "AXList", "AXImage", "AXSplitter", "AXCheckBox"}
	tell application "System Events" to tell process "Conductor"
		set level to {window mainIdx}
		set depth to 0
		repeat while (count of level) > 0 and depth < 14 and visited < 400
			set nextLevel to {}
			repeat with entry in level
				set node to contents of entry
				set visited to visited + 1
				set nodeRole to ""
				try
					set nodeRole to role of node
				end try
				if nodeRole is "AXTabGroup" then set end of found to node
				if leafRoles does not contain nodeRole then
					try
						set kids to (get UI elements of node)
						if (count of kids) <= widthLimit then set nextLevel to nextLevel & kids
					end try
				end if
			end repeat
			set level to nextLevel
			set depth to depth + 1
		end repeat
	end tell
	return found
end collectTabGroups

on composerPane(strips)
	-- The pane that holds the composer: the parent of whichever strip has a "composer"
	-- group beside it. With the chat strip and the terminal strip in different containers
	-- (0.92.0) `item 1 of strips` is the terminal strip, whose parent has no composer, so
	-- the pane is looked up rather than assumed. Before the split every strip shared one
	-- parent, and the first one that has the composer is still the first one. missing value
	-- when none does, which callers already treat as "fall back to pasting".
	repeat with entry in strips
		try
			tell application "System Events" to tell process "Conductor"
				set pane to value of attribute "AXParent" of (contents of entry)
				if (count of (UI elements of pane whose name is "composer")) > 0 then return pane
			end tell
		end try
	end repeat
	return missing value
end composerPane

on stripRadios(tg)
	-- Every radio button in a tab strip, whether it is a direct child or sits one
	-- group deep, in tree order. Both shapes are live at once: the terminal strip's
	-- tabs are direct children, while a chat tab is wrapped in its own AXGroup with
	-- the file-view toggle beside it as a plain child. Reading only the direct ones
	-- (and stopping as soon as any turned up) is what made a chat strip look like a
	-- one-tab strip called "Close file view".
	tell application "System Events" to tell process "Conductor"
		set acc to {}
		repeat with k in (UI elements of tg)
			set node to contents of k
			if (role of node) is "AXRadioButton" then
				set end of acc to node
			else
				try
					set acc to acc & (get UI elements of node whose role is "AXRadioButton")
				end try
			end if
		end repeat
		return acc
	end tell
end stripRadios

on chatTabs(tg)
	-- Of those, a chat tab is the one whose accessible name is its own close action,
	-- "Close chat <title>". The strip's other radio button is "Close file view",
	-- which is not a chat and must not shift the indices this file addresses tabs
	-- by — off by one is how a prompt lands in the wrong conversation. Falls back to
	-- every radio button when none carries the prefix, so a renamed label costs the
	-- filter rather than emptying the strip.
	set radios to my stripRadios(tg)
	set chats to {}
	repeat with entry in radios
		set node to contents of entry
		if (my axName(node)) starts with "Close chat" then set end of chats to node
	end repeat
	if (count of chats) > 0 then return chats
	return radios
end chatTabs

on hasChatTabs(strips)
	-- Is any strip a chat strip: one with a radio button named "Close chat <title>". The
	-- terminal strip never is, whatever its radio buttons are called.
	repeat with entry in strips
		repeat with r in my stripRadios(contents of entry)
			if (my axName(contents of r)) starts with "Close chat" then return true
		end repeat
	end repeat
	return false
end hasChatTabs

on tabLabel(t)
	tell application "System Events" to tell process "Conductor"
		return (name of t) as text
	end tell
end tabLabel

on pickChatStrip(strips, wantCount, wantTitle)
	-- Score each candidate strip: a label match outweighs a tab-count match, and
	-- a tie means we cannot tell the chat strip from the terminal strip.
	set best to missing value
	set bestTabs to {}
	set bestScore to 0
	set tied to false
	repeat with entry in strips
		set tg to contents of entry
		set strip to my chatTabs(tg)
		set score to 0
		if wantCount > 0 and (count of strip) is wantCount then set score to score + 1
		if wantTitle is not "" then
			repeat with t in strip
				if (my tabLabel(t)) contains wantTitle then
					set score to score + 2
					exit repeat
				end if
			end repeat
		end if
		if score > bestScore then
			set bestScore to score
			set best to tg
			set bestTabs to strip
			set tied to false
		else if score is bestScore and score > 0 then
			set tied to true
		end if
	end repeat
	if bestScore is 0 then error "couldn't identify the chat tab strip"
	if tied then error "can't tell which tab strip holds the target chat"
	return {best, bestTabs}
end pickChatStrip

on lastPathSegment(s)
	set saved to AppleScript's text item delimiters
	set AppleScript's text item delimiters to "/"
	set parts to text items of s
	set AppleScript's text item delimiters to saved
	return item -1 of parts
end lastPathSegment

on paneLabels(tg, wantRole)
	-- Kept out of the caller's scope on purpose: inside a System Events tell,
	-- ordinary-looking names (tabs, count) resolve as app terms instead of vars.
	tell application "System Events" to tell process "Conductor"
		set pane to value of attribute "AXParent" of tg
		return (name of (UI elements of pane whose role is wantRole))
	end tell
end paneLabels

on anyContains(haystack, needle)
	repeat with entry in haystack
		try
			if (entry as text) contains needle then return true
		end try
	end repeat
	return false
end anyContains

on assertWorkspace(tg)
	-- The pane holding the chat strip also labels the open workspace: an
	-- AXStaticText with the branch (sans owner prefix) and a repo popup button.
	set wantBranch to system attribute "RELAY_WS_BRANCH"
	if wantBranch is "" then return
	set tail to my lastPathSegment(wantBranch)
	if not (my anyContains(my paneLabels(tg, "AXStaticText"), tail)) then
		error "the palette didn't land on " & tail
	end if
	set wantRepo to system attribute "RELAY_WS_REPO"
	if wantRepo is not "" then
		if not (my anyContains(my paneLabels(tg, "AXPopUpButton"), wantRepo)) then
			error "the palette didn't land in " & wantRepo
		end if
	end if
end assertWorkspace
