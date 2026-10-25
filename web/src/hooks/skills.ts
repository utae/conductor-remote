import { useQuery } from '@tanstack/react-query'
import { client } from '../lib/api.ts'

/**
 * The skills a `/` in this workspace's composer can name. Fetched only once a draft actually starts with a slash
 * (`enabled`), so a chat that never uses one never pays for the request, and then kept for a minute: the answer is
 * files on the Mac that change when someone installs a plugin, not while they type.
 */
export function useSkills(workspaceId: string, enabled: boolean) {
	return useQuery({
		queryKey: ['skills', workspaceId],
		queryFn: () => client.workspaceSkills(workspaceId),
		enabled,
		staleTime: 60_000,
		retry: false
	})
}
