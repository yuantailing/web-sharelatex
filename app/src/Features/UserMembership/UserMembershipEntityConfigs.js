// TODO: This file was created by bulk-decaffeinate.
// Sanity-check the conversion and remove this comment.
/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
module.exports = {
  group: {
    modelName: 'Subscription',
    readOnly: true,
    hasMembersLimit: true,
    fields: {
      primaryKey: '_id',
      read: ['invited_emails', 'teamInvites', 'member_ids'],
      write: null,
      access: 'manager_ids',
      name: 'teamName'
    },
    baseQuery: {
      groupPlan: true
    },
    translations: {
      title: 'group_account',
      subtitle: 'members_management',
      remove: 'remove_from_group'
    },
    pathsFor(id) {
      return {
        addMember: `/SHARELATEX/manage/groups/${id}/invites`,
        removeMember: `/SHARELATEX/manage/groups/${id}/user`,
        removeInvite: `/SHARELATEX/manage/groups/${id}/invites`,
        exportMembers: `/SHARELATEX/manage/groups/${id}/members/export`
      }
    }
  },

  team: {
    // for metrics only
    modelName: 'Subscription',
    fields: {
      primaryKey: 'overleaf.id',
      access: 'manager_ids'
    },
    baseQuery: {
      groupPlan: true
    }
  },

  groupManagers: {
    modelName: 'Subscription',
    fields: {
      primaryKey: '_id',
      read: ['manager_ids'],
      write: 'manager_ids',
      access: 'manager_ids',
      name: 'teamName'
    },
    baseQuery: {
      groupPlan: true
    },
    translations: {
      title: 'group_account',
      subtitle: 'managers_management',
      remove: 'remove_manager'
    },
    pathsFor(id) {
      return {
        addMember: `/SHARELATEX/manage/groups/${id}/managers`,
        removeMember: `/SHARELATEX/manage/groups/${id}/managers`
      }
    }
  },

  institution: {
    modelName: 'Institution',
    canCreate: true,
    fields: {
      primaryKey: 'v1Id',
      read: ['managerIds'],
      write: 'managerIds',
      access: 'managerIds',
      name: 'name'
    },
    translations: {
      title: 'institution_account',
      subtitle: 'managers_management',
      remove: 'remove_manager'
    },
    pathsFor(id) {
      return {
        index: `/SHARELATEX/manage/institutions/${id}/managers`,
        addMember: `/SHARELATEX/manage/institutions/${id}/managers`,
        removeMember: `/SHARELATEX/manage/institutions/${id}/managers`
      }
    }
  },

  publisher: {
    modelName: 'Publisher',
    canCreate: true,
    fields: {
      primaryKey: 'slug',
      read: ['managerIds'],
      write: 'managerIds',
      access: 'managerIds',
      name: 'name'
    },
    translations: {
      title: 'publisher_account',
      subtitle: 'managers_management',
      remove: 'remove_manager'
    },
    pathsFor(id) {
      return {
        index: `/SHARELATEX/manage/publishers/${id}/managers`,
        addMember: `/SHARELATEX/manage/publishers/${id}/managers`,
        removeMember: `/SHARELATEX/manage/publishers/${id}/managers`
      }
    }
  },

  conversion: {
    // for metrics only
    modelName: 'Publisher',
    fields: {
      primaryKey: 'slug',
      access: 'managerIds'
    }
  },

  admin: {
    // for metrics only
    modelName: null
  }
}
