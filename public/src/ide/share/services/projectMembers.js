/* eslint-disable
    camelcase,
    no-undef,
*/
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
define(['base'], App =>
  App.factory('projectMembers', (ide, $http) => ({
    removeMember(member) {
      return $http({
        url: `/SHARELATEX/project/${ide.project_id}/users/${member._id}`,
        method: 'DELETE',
        headers: {
          'X-Csrf-Token': window.csrfToken
        }
      })
    },

    addGroup(group_id, privileges) {
      return $http.post(`/SHARELATEX/project/${ide.project_id}/group`, {
        group_id,
        privileges,
        _csrf: window.csrfToken
      })
    },

    getMembers() {
      return $http.get(`/SHARELATEX/project/${ide.project_id}/members`, {
        json: true,
        headers: {
          'X-Csrf-Token': window.csrfToken
        }
      })
    }
  })))
