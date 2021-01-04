/* eslint-disable
    camelcase,
    handle-callback-err,
    max-len,
    no-return-assign,
    no-unused-vars,
*/
// TODO: This file was created by bulk-decaffeinate.
// Fix any style issues and re-enable lint.
/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
let SubscriptionController
const AuthenticationController = require('../Authentication/AuthenticationController')
const SubscriptionHandler = require('./SubscriptionHandler')
const PlansLocator = require('./PlansLocator')
const SubscriptionViewModelBuilder = require('./SubscriptionViewModelBuilder')
const LimitationsManager = require('./LimitationsManager')
const RecurlyWrapper = require('./RecurlyWrapper')
const Settings = require('settings-sharelatex')
const logger = require('logger-sharelatex')
const GeoIpLookup = require('../../infrastructure/GeoIpLookup')
const UserGetter = require('../User/UserGetter')
const FeaturesUpdater = require('./FeaturesUpdater')
const planFeatures = require('./planFeatures')
const GroupPlansData = require('./GroupPlansData')
const V1SubscriptionManager = require('./V1SubscriptionManager')
const Errors = require('../Errors/Errors')
const HttpErrorHandler = require('../Errors/HttpErrorHandler')
const SubscriptionErrors = require('./Errors')
const OError = require('@overleaf/o-error')

module.exports = SubscriptionController = {
  plansPage(req, res, next) {
    const plans = SubscriptionViewModelBuilder.buildPlansList()
    let viewName = 'subscriptions/plans'
    if (req.query.v != null) {
      viewName = `${viewName}_${req.query.v}`
    }
    let currentUser = null

    return GeoIpLookup.getCurrencyCode(
      (req.query != null ? req.query.ip : undefined) || req.ip,
      function(err, recomendedCurrency) {
        if (err != null) {
          return next(err)
        }
        const render = () =>
          res.render(viewName, {
            title: 'plans_and_pricing',
            plans,
            gaExperiments: Settings.gaExperiments.plansPage,
            gaOptimize: true,
            recomendedCurrency,
            planFeatures,
            groupPlans: GroupPlansData
          })
        const user_id = AuthenticationController.getLoggedInUserId(req)
        if (user_id != null) {
          return UserGetter.getUser(user_id, { signUpDate: 1 }, function(
            err,
            user
          ) {
            if (err != null) {
              return next(err)
            }
            currentUser = user
            return render()
          })
        } else {
          return render()
        }
      }
    )
  },

  // get to show the recurly.js page
  paymentPage(req, res, next) {
    const user = AuthenticationController.getSessionUser(req)
    const plan = PlansLocator.findLocalPlanInSettings(req.query.planCode)
    if (!plan) {
      return HttpErrorHandler.unprocessableEntity(req, res, 'Plan not found')
    }
    return LimitationsManager.userHasV1OrV2Subscription(user, function(
      err,
      hasSubscription
    ) {
      if (err != null) {
        return next(err)
      }
      if (hasSubscription) {
        return res.redirect('/SHARELATEX/user/subscription?hasSubscription=true')
      } else {
        // LimitationsManager.userHasV2Subscription only checks Mongo. Double check with
        // Recurly as well at this point (we don't do this most places for speed).
        return SubscriptionHandler.validateNoSubscriptionInRecurly(
          user._id,
          function(error, valid) {
            if (error != null) {
              return next(error)
            }
            if (!valid) {
              res.redirect('/SHARELATEX/user/subscription?hasSubscription=true')
            } else {
              let currency =
                req.query.currency != null
                  ? req.query.currency.toUpperCase()
                  : undefined
              return GeoIpLookup.getCurrencyCode(
                (req.query != null ? req.query.ip : undefined) || req.ip,
                function(err, recomendedCurrency, countryCode) {
                  if (err != null) {
                    return next(err)
                  }
                  if (recomendedCurrency != null && currency == null) {
                    currency = recomendedCurrency
                  }
                  return res.render('subscriptions/new', {
                    title: 'subscribe',
                    plan_code: req.query.planCode,
                    currency,
                    countryCode,
                    plan,
                    showStudentPlan: req.query.ssp,
                    recurlyConfig: JSON.stringify({
                      currency,
                      subdomain: Settings.apis.recurly.subdomain
                    }),
                    showCouponField: req.query.scf,
                    showVatField: req.query.svf,
                    couponCode: req.query.cc || '',
                    gaOptimize: true,
                    ITMCampaign: req.query.itm_campaign,
                    ITMContent: req.query.itm_content
                  })
                }
              )
            }
          }
        )
      }
    })
  },

  userSubscriptionPage(req, res, next) {
    const user = AuthenticationController.getSessionUser(req)
    return SubscriptionViewModelBuilder.buildUsersSubscriptionViewModel(
      user,
      function(error, results) {
        if (error != null) {
          return next(error)
        }
        const {
          personalSubscription,
          memberGroupSubscriptions,
          managedGroupSubscriptions,
          confirmedMemberAffiliations,
          managedInstitutions,
          managedPublishers,
          v1SubscriptionStatus
        } = results
        return LimitationsManager.userHasV1OrV2Subscription(user, function(
          err,
          hasSubscription
        ) {
          if (error != null) {
            return next(error)
          }
          const fromPlansPage = req.query.hasSubscription
          const plans = SubscriptionViewModelBuilder.buildPlansList()
          const data = {
            title: 'your_subscription',
            plans,
            user,
            hasSubscription,
            fromPlansPage,
            personalSubscription,
            memberGroupSubscriptions,
            managedGroupSubscriptions,
            confirmedMemberAffiliations,
            managedInstitutions,
            managedPublishers,
            v1SubscriptionStatus
          }
          return res.render('subscriptions/dashboard', data)
        })
      }
    )
  },

  createSubscription(req, res, next) {
    const user = AuthenticationController.getSessionUser(req)
    const recurlyTokenIds = {
      billing: req.body.recurly_token_id,
      threeDSecureActionResult:
        req.body.recurly_three_d_secure_action_result_token_id
    }
    const { subscriptionDetails } = req.body

    return LimitationsManager.userHasV1OrV2Subscription(user, function(
      err,
      hasSubscription
    ) {
      if (err != null) {
        return next(err)
      }
      if (hasSubscription) {
        logger.warn({ user_id: user._id }, 'user already has subscription')
        return res.sendStatus(409) // conflict
      }
      return SubscriptionHandler.createSubscription(
        user,
        subscriptionDetails,
        recurlyTokenIds,
        function(err) {
          if (!err) {
            return res.sendStatus(201)
          }

          if (
            err instanceof SubscriptionErrors.RecurlyTransactionError ||
            err instanceof Errors.InvalidError
          ) {
            logger.warn(err)
            return HttpErrorHandler.unprocessableEntity(
              req,
              res,
              err.message,
              OError.getFullInfo(err).public
            )
          }

          logger.warn(
            { err, user_id: user._id },
            'something went wrong creating subscription'
          )
          next(err)
        }
      )
    })
  },

  successful_subscription(req, res, next) {
    const user = AuthenticationController.getSessionUser(req)
    return SubscriptionViewModelBuilder.buildUsersSubscriptionViewModel(
      user,
      function(error, { personalSubscription }) {
        if (error != null) {
          return next(error)
        }
        if (personalSubscription == null) {
          return res.redirect('/SHARELATEX/user/subscription/plans')
        }
        return res.render('subscriptions/successful_subscription', {
          title: 'thank_you',
          personalSubscription
        })
      }
    )
  },

  cancelSubscription(req, res, next) {
    const user = AuthenticationController.getSessionUser(req)
    logger.log({ user_id: user._id }, 'canceling subscription')
    return SubscriptionHandler.cancelSubscription(user, function(err) {
      if (err != null) {
        OError.tag(err, 'something went wrong canceling subscription', {
          user_id: user._id
        })
        return next(err)
      }
      // Note: this redirect isn't used in the main flow as the redirection is
      // handled by Angular
      return res.redirect('/SHARELATEX/user/subscription/canceled')
    })
  },

  canceledSubscription(req, res, next) {
    const user = AuthenticationController.getSessionUser(req)
    return res.render('subscriptions/canceled_subscription', {
      title: 'subscription_canceled'
    })
  },

  cancelV1Subscription(req, res, next) {
    const user_id = AuthenticationController.getLoggedInUserId(req)
    logger.log({ user_id }, 'canceling v1 subscription')
    return V1SubscriptionManager.cancelV1Subscription(user_id, function(err) {
      if (err != null) {
        OError.tag(err, 'something went wrong canceling v1 subscription', {
          user_id
        })
        return next(err)
      }
      return res.redirect('/SHARELATEX/user/subscription')
    })
  },

  updateSubscription(req, res, next) {
    const _origin =
      __guard__(req != null ? req.query : undefined, x => x.origin) || null
    const user = AuthenticationController.getSessionUser(req)
    const planCode = req.body.plan_code
    if (planCode == null) {
      const err = new Error('plan_code is not defined')
      logger.warn(
        { user_id: user._id, err, planCode, origin: _origin, body: req.body },
        '[Subscription] error in updateSubscription form'
      )
      return next(err)
    }
    logger.log({ planCode, user_id: user._id }, 'updating subscription')
    return SubscriptionHandler.updateSubscription(
      user,
      planCode,
      null,
      function(err) {
        if (err != null) {
          OError.tag(err, 'something went wrong updating subscription', {
            user_id: user._id
          })
          return next(err)
        }
        return res.redirect('/SHARELATEX/user/subscription')
      }
    )
  },

  updateAccountEmailAddress(req, res, next) {
    const user = AuthenticationController.getSessionUser(req)
    RecurlyWrapper.updateAccountEmailAddress(user._id, user.email, function(
      error
    ) {
      if (error) {
        return next(error)
      }
      res.sendStatus(200)
    })
  },

  reactivateSubscription(req, res, next) {
    const user = AuthenticationController.getSessionUser(req)
    logger.log({ user_id: user._id }, 'reactivating subscription')
    return SubscriptionHandler.reactivateSubscription(user, function(err) {
      if (err != null) {
        OError.tag(err, 'something went wrong reactivating subscription', {
          user_id: user._id
        })
        return next(err)
      }
      return res.redirect('/SHARELATEX/user/subscription')
    })
  },

  recurlyCallback(req, res, next) {
    logger.log({ data: req.body }, 'received recurly callback')
    const event = Object.keys(req.body)[0]
    const eventData = req.body[event]
    if (
      [
        'new_subscription_notification',
        'updated_subscription_notification',
        'expired_subscription_notification'
      ].includes(event)
    ) {
      const recurlySubscription = eventData.subscription
      return SubscriptionHandler.syncSubscription(
        recurlySubscription,
        { ip: req.ip },
        function(err) {
          if (err != null) {
            return next(err)
          }
          return res.sendStatus(200)
        }
      )
    } else if (event === 'billing_info_updated_notification') {
      const recurlyAccountCode = eventData.account.account_code
      return SubscriptionHandler.attemptPaypalInvoiceCollection(
        recurlyAccountCode,
        function(err) {
          if (err) {
            return next(err)
          }
          return res.sendStatus(200)
        }
      )
    } else {
      return res.sendStatus(200)
    }
  },

  renderUpgradeToAnnualPlanPage(req, res, next) {
    const user = AuthenticationController.getSessionUser(req)
    return LimitationsManager.userHasV2Subscription(user, function(
      err,
      hasSubscription,
      subscription
    ) {
      let planName
      if (err != null) {
        return next(err)
      }
      const planCode =
        subscription != null ? subscription.planCode.toLowerCase() : undefined
      if ((planCode != null ? planCode.indexOf('annual') : undefined) !== -1) {
        planName = 'annual'
      } else if (
        (planCode != null ? planCode.indexOf('student') : undefined) !== -1
      ) {
        planName = 'student'
      } else if (
        (planCode != null ? planCode.indexOf('collaborator') : undefined) !== -1
      ) {
        planName = 'collaborator'
      }
      if (!hasSubscription) {
        return res.redirect('/SHARELATEX/user/subscription/plans')
      }
      return res.render('subscriptions/upgradeToAnnual', {
        title: 'Upgrade to annual',
        planName
      })
    })
  },

  processUpgradeToAnnualPlan(req, res, next) {
    const user = AuthenticationController.getSessionUser(req)
    const { planName } = req.body
    const coupon_code = Settings.coupon_codes.upgradeToAnnualPromo[planName]
    const annualPlanName = `${planName}-annual`
    logger.log(
      { user_id: user._id, planName: annualPlanName },
      'user is upgrading to annual billing with discount'
    )
    return SubscriptionHandler.updateSubscription(
      user,
      annualPlanName,
      coupon_code,
      function(err) {
        if (err != null) {
          OError.tag(err, 'error updating subscription', {
            user_id: user._id
          })
          return next(err)
        }
        return res.sendStatus(200)
      }
    )
  },

  extendTrial(req, res, next) {
    const user = AuthenticationController.getSessionUser(req)
    return LimitationsManager.userHasV2Subscription(user, function(
      err,
      hasSubscription,
      subscription
    ) {
      if (err != null) {
        return next(err)
      }
      return SubscriptionHandler.extendTrial(subscription, 14, function(err) {
        if (err != null) {
          return res.sendStatus(500)
        } else {
          return res.sendStatus(200)
        }
      })
    })
  },

  recurlyNotificationParser(req, res, next) {
    let xml = ''
    req.on('data', chunk => (xml += chunk))
    return req.on('end', () =>
      RecurlyWrapper._parseXml(xml, function(error, body) {
        if (error != null) {
          return next(error)
        }
        req.body = body
        return next()
      })
    )
  },

  refreshUserFeatures(req, res, next) {
    const { user_id } = req.params
    return FeaturesUpdater.refreshFeatures(user_id, function(error) {
      if (error != null) {
        return next(error)
      }
      return res.sendStatus(200)
    })
  }
}

function __guard__(value, transform) {
  return typeof value !== 'undefined' && value !== null
    ? transform(value)
    : undefined
}
